import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { SignFlowField } from "../esign/signflow.service.js";

/** Stable fingerprint for a single PDF page (content-based). */
export async function computePdfPageFingerprints(buffer: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const hashes: string[] = [];

  for (const idx of doc.getPageIndices()) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(doc, [idx]);
    single.addPage(page);
    const bytes = await single.save();
    hashes.push(createHash("sha256").update(bytes).digest("hex").slice(0, 16));
  }

  return hashes;
}

/**
 * Maps 1-based template page numbers to 1-based signing PDF page numbers by
 * matching page fingerprints in order (handles prepended answer pages).
 */
export function buildTemplatePageToSigningPageMap(
  referenceHashes: string[],
  signingHashes: string[],
): Map<number, number> {
  const map = new Map<number, number>();
  let signingCursor = 0;

  for (let t = 0; t < referenceHashes.length; t++) {
    const refHash = referenceHashes[t];
    let matched = -1;

    for (let s = signingCursor; s < signingHashes.length; s++) {
      if (signingHashes[s] === refHash) {
        matched = s;
        break;
      }
    }

    if (matched >= 0) {
      map.set(t + 1, matched + 1);
      signingCursor = matched + 1;
    } else if (signingCursor < signingHashes.length) {
      map.set(t + 1, signingCursor + 1);
      signingCursor += 1;
    }
  }

  return map;
}

function resolveSigningPageForField(
  field: SignFlowField,
  pageMap: Map<number, number>,
  signingHashes: string[],
  referenceHashes: string[],
): number {
  const pageHash = field.pageHash?.trim();
  if (pageHash) {
    const byHash = signingHashes.indexOf(pageHash);
    if (byHash >= 0) return byHash + 1;
  }

  const templatePage = Math.max(
    1,
    Math.floor(field.templatePage ?? field.page),
  );
  const mapped = pageMap.get(templatePage);
  if (mapped != null) return mapped;

  const refHash = referenceHashes[templatePage - 1];
  if (refHash) {
    const byRefHash = signingHashes.indexOf(refHash);
    if (byRefHash >= 0) return byRefHash + 1;
  }

  return Math.max(1, Math.floor(field.page));
}

/**
 * Re-maps sponsor-placed field pages from the template PDF to the investor
 * signing PDF. x/y/width/height and profile scope are unchanged.
 */
export async function remapSignFlowFieldsToSigningPdf(
  fields: SignFlowField[],
  referencePdf: Buffer,
  signingPdf: Buffer,
): Promise<SignFlowField[]> {
  if (!fields.length) return fields;

  const [referenceHashes, signingHashes] = await Promise.all([
    computePdfPageFingerprints(referencePdf),
    computePdfPageFingerprints(signingPdf),
  ]);
  const pageMap = buildTemplatePageToSigningPageMap(
    referenceHashes,
    signingHashes,
  );

  return fields.map((field) => {
    const templatePage = Math.max(
      1,
      Math.floor(field.templatePage ?? field.page),
    );
    const page = resolveSigningPageForField(
      field,
      pageMap,
      signingHashes,
      referenceHashes,
    );
    return {
      ...field,
      page,
      templatePage,
      pageHash:
        field.pageHash?.trim() || referenceHashes[templatePage - 1] || undefined,
    };
  });
}

function signFlowFieldCoordPercent(value: number | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function signFlowFieldDedupeRank(field: SignFlowField): number {
  const type = String(field.type ?? "")
    .trim()
    .toLowerCase();
  if (type === "signature") return 0;
  if (type === "text") return 1;
  if (type === "date_signed") return 4;
  return 2;
}

function signFlowFieldCenter(field: SignFlowField): { x: number; y: number } {
  return {
    x:
      signFlowFieldCoordPercent(field.x, 0) +
      signFlowFieldCoordPercent(field.width, 1) / 2,
    y:
      signFlowFieldCoordPercent(field.y, 0) +
      signFlowFieldCoordPercent(field.height, 1) / 2,
  };
}

function signFlowFieldsSamePlacement(a: SignFlowField, b: SignFlowField): boolean {
  const pageA = Math.max(1, Math.floor(a.page));
  const pageB = Math.max(1, Math.floor(b.page));
  if (pageA !== pageB) return false;
  if (
    String(a.recipientId ?? "").trim() !== String(b.recipientId ?? "").trim()
  ) {
    return false;
  }

  const centerA = signFlowFieldCenter(a);
  const centerB = signFlowFieldCenter(b);
  if (
    Math.abs(centerA.x - centerB.x) <= 2 &&
    Math.abs(centerA.y - centerB.y) <= 2
  ) {
    return true;
  }

  const ax = signFlowFieldCoordPercent(a.x, 0);
  const ay = signFlowFieldCoordPercent(a.y, 0);
  const aw = Math.max(0.5, signFlowFieldCoordPercent(a.width, 1));
  const ah = Math.max(0.5, signFlowFieldCoordPercent(a.height, 1));
  const bx = signFlowFieldCoordPercent(b.x, 0);
  const by = signFlowFieldCoordPercent(b.y, 0);
  const bw = Math.max(0.5, signFlowFieldCoordPercent(b.width, 1));
  const bh = Math.max(0.5, signFlowFieldCoordPercent(b.height, 1));

  const overlapX = ax < bx + bw && ax + aw > bx;
  const overlapY = ay < by + bh && ay + ah > by;
  if (!overlapX || !overlapY) return false;

  const labelA = String(a.label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const labelB = String(b.label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (labelA && labelA === labelB) return true;

  const typeA = String(a.type ?? "")
    .trim()
    .toLowerCase();
  const typeB = String(b.type ?? "")
    .trim()
    .toLowerCase();
  if (typeA === typeB) return true;

  const types = new Set([typeA, typeB]);
  if (types.has("signature") && (types.has("date_signed") || types.has("date"))) {
    return true;
  }

  return false;
}

function signFlowFieldsOverlap(a: SignFlowField, b: SignFlowField): boolean {
  return signFlowFieldsSamePlacement(a, b);
}

/** Drop duplicate/overlapping SignFlow fields (template + preset questionnaire fields). */
export function dedupeSignFlowFieldsByPlacement(
  fields: SignFlowField[],
): SignFlowField[] {
  const out: SignFlowField[] = [];
  for (const field of fields) {
    const overlapIdx = out.findIndex((existing) =>
      signFlowFieldsOverlap(existing, field),
    );
    if (overlapIdx < 0) {
      out.push(field);
      continue;
    }
    if (
      signFlowFieldDedupeRank(field) <
      signFlowFieldDedupeRank(out[overlapIdx]!)
    ) {
      out[overlapIdx] = field;
    }
  }
  return out;
}
