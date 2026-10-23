/**
 * When an investor completes eSign, mirror signed PDFs into the deal Documents tab
 * under a dedicated "Esign template" section (`offering_investor_preview_json.sections`).
 */

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { getUploadsPhysicalRoot } from "../../config/uploadPaths.js";
import {
  commitmentProfileDisplayLabel,
  esignSendReadyForSponsorCounterSign,
  parseEsignStatusBundle,
  type StoredDealInvestorEsignSend,
} from "../../constants/deal-investor-esign-status.js";
import { getActiveEsignProvider } from "../../config/esignProvider.config.js";
import { resolveEsignSignflowWorkflowType } from "../../constants/esignSigningWorkflow.js";
import {
  getSignFlowDocument,
  downloadSignFlowRecipientSignedPdfBuffer,
  downloadSignFlowSignedPdfBuffer,
  isSignFlowNotAllSignedError,
  resolveSignFlowSponsorRecipientId,
  signFlowSponsorSignsBeforeInvestor,
  signFlowInvestorPhaseComplete,
  signFlowPendingSponsorSignAudience,
  signFlowTemplateHasSponsorFields,
} from "../esign/signflow.service.js";
import { db } from "../../database/db.js";
import { dealInvestment } from "../../schema/deal.schema/deal-investment.schema.js";
import { dealLpInvestor } from "../../schema/deal.schema/deal-lp-investor.schema.js";
import { formatDdMmmYyyy } from "../../utils/formatDdMmmYyyy.js";
import { sanitizeOfferingInvestorPreviewBody } from "../../utils/sanitizeOfferingInvestorPreviewJson.js";
import {
  getAddDealFormById,
  updateDealOfferingInvestorPreviewById,
} from "./dealForm.service.js";
import { sequentialWorkflowSponsorDocsGateOpen } from "./dealSequentialEsignWorkflow.service.js";
import {
  findEsignTemplateFile,
  getDealEsignTemplatesState,
  type EsignTemplatesJson,
} from "./dealEsignTemplates.service.js";
import { updateDealInvestorEsignSend } from "./dealMemberEsignStatus.service.js";
import {
  DEAL_ESIGN_COMPLETED_FOLDER,
  dealAssetsRelativePath,
  resolveDealStorageFolderName,
  sanitizeStoragePathSegment,
} from "./dealStoragePaths.service.js";

export const ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID =
  "esign-template-documents-section";

export const ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL = "Investor e signatures";

const LEGACY_ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL = "Esign template";

function uploadPublicUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "").replace(/^uploads\//i, "");
  return rel ? `/uploads/${rel}` : "";
}

function sendHasStoredOrRecordedSignature(
  send: StoredDealInvestorEsignSend,
): boolean {
  if (send.completedAt?.trim() || send.signedAt?.trim()) return true;
  return (send.documents ?? []).some((d) => Boolean(d.signedRelativePath?.trim()));
}

function listSignedEsignDocumentsForSend(
  send: StoredDealInvestorEsignSend,
  signatureRequestId: string,
  opts?: { preferFullSignedCopy?: boolean },
): Array<{ fileId: string; name: string; url: string | null }> {
  if (!sendHasStoredOrRecordedSignature(send)) return [];
  const docs = send.documents ?? [];
  if (docs.length === 0) return [];

  const investorPath =
    docs.find((d) => d.signedRelativePath?.trim())?.signedRelativePath?.trim() ??
    "";
  const fullPath = send.fullSignedRelativePath?.trim() ?? "";
  const sharedPath =
    opts?.preferFullSignedCopy && fullPath ? fullPath : investorPath;
  const sharedUrl = sharedPath ? uploadPublicUrl(sharedPath) : null;
  const sig = signatureRequestId.trim();

  return docs.map((d) => {
    const rel =
      (opts?.preferFullSignedCopy && fullPath ? fullPath : "") ||
      d.signedRelativePath?.trim() ||
      sharedPath;
    const url = rel ? uploadPublicUrl(rel) : sharedUrl;
    const compositeId = sig && d.fileId ? `${sig}::${d.fileId}` : d.fileId;
    return {
      fileId: compositeId,
      name: d.name,
      url: url || null,
    };
  });
}

/** Sent packet the sponsor can open before the investor signs (template preview). */
function listPendingEsignDocumentsForSponsor(
  send: StoredDealInvestorEsignSend,
  signatureRequestId: string,
): Array<{ fileId: string; name: string; url: string | null }> {
  const sig = signatureRequestId.trim();
  const docs = send.documents ?? [];
  if (docs.length === 0) {
    if (!sig) return [];
    return [{ fileId: sig, name: "eSign document", url: null }];
  }
  return docs.map((d) => {
    const sponsorPath = send.sponsorSignedRelativePath?.trim() ?? "";
    const fullPath = send.fullSignedRelativePath?.trim() ?? "";
    const templatePath = d.templateRelativePath?.trim() ?? "";
    const viewPath = sponsorPath || fullPath || templatePath;
    const compositeId = sig && d.fileId ? `${sig}::${d.fileId}` : d.fileId || sig;
    return {
      fileId: compositeId,
      name: d.name?.trim() || "eSign document",
      url: viewPath ? uploadPublicUrl(viewPath) : null,
    };
  });
}

async function writeStoredEsignPdf(params: {
  dealId: string;
  rosterId: string;
  filePrefix: string;
  buffer: Buffer;
}): Promise<string> {
  const dealFolder = await resolveDealStorageFolderName(params.dealId);
  const rosterFolder =
    sanitizeStoragePathSegment(params.rosterId, 64) || "investor";
  const relativePath = dealAssetsRelativePath(
    dealFolder,
    DEAL_ESIGN_COMPLETED_FOLDER,
    rosterFolder,
    `${params.filePrefix}-${Date.now()}.pdf`,
  );
  const abs = path.join(getUploadsPhysicalRoot(), relativePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, params.buffer);
  return relativePath;
}

/**
 * After the sponsor signs, Documents → View must open that signed PDF.
 * Before the investor signs, that is the sponsor copy. Once both have signed,
 * it is the fully executed PDF.
 */
async function ensureSponsorSignedPdfForDocumentsView(params: {
  dealId: string;
  rosterId: string;
  investorRowTable: "investment" | "lp";
  signatureRequestId: string;
  send: StoredDealInvestorEsignSend;
  investorPacketReady: boolean;
}): Promise<StoredDealInvestorEsignSend> {
  const existingFull = params.send.fullSignedRelativePath?.trim() ?? "";
  if (existingFull && params.investorPacketReady) return params.send;
  const existingSponsor = params.send.sponsorSignedRelativePath?.trim() ?? "";
  if (existingSponsor && !params.investorPacketReady) return params.send;

  const target = {
    table: params.investorRowTable,
    id: params.rosterId,
  };

  if (params.investorPacketReady && !existingFull) {
    try {
      const buffer = await downloadSignFlowSignedPdfBuffer(
        params.signatureRequestId,
      );
      const fullSignedRelativePath = await writeStoredEsignPdf({
        dealId: params.dealId,
        rosterId: params.rosterId,
        filePrefix: "signed-full",
        buffer,
      });
      await updateDealInvestorEsignSend(
        params.dealId,
        target,
        params.signatureRequestId,
        (current) => ({ ...current, fullSignedRelativePath }),
      );
      return { ...params.send, fullSignedRelativePath };
    } catch (err) {
      if (!isSignFlowNotAllSignedError(err)) {
        console.warn("ensureSponsorSignedPdfForDocumentsView (full):", err);
      }
    }
  }

  if (existingSponsor) return params.send;

  try {
    const doc = await getSignFlowDocument(params.signatureRequestId);
    const sponsorId = resolveSignFlowSponsorRecipientId(doc);
    const buffer = await downloadSignFlowRecipientSignedPdfBuffer(
      params.signatureRequestId,
      sponsorId,
    );
    const sponsorSignedRelativePath = await writeStoredEsignPdf({
      dealId: params.dealId,
      rosterId: params.rosterId,
      filePrefix: "signed-sponsor",
      buffer,
    });
    await updateDealInvestorEsignSend(
      params.dealId,
      target,
      params.signatureRequestId,
      (current) => ({ ...current, sponsorSignedRelativePath }),
    );
    return { ...params.send, sponsorSignedRelativePath };
  } catch (err) {
    console.warn("ensureSponsorSignedPdfForDocumentsView (sponsor):", err);
    return params.send;
  }
}

type PreviewParts = {
  visibility: Record<string, boolean>;
  sections: Record<string, unknown>[];
};

function readPreviewParts(raw: string | null | undefined): PreviewParts {
  if (!raw?.trim()) return { visibility: {}, sections: [] };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const visibility =
      parsed.visibility != null &&
      typeof parsed.visibility === "object" &&
      !Array.isArray(parsed.visibility)
        ? (parsed.visibility as Record<string, boolean>)
        : {};
    const sections = Array.isArray(parsed.sections)
      ? (parsed.sections as Record<string, unknown>[])
      : [];
    return { visibility, sections };
  } catch {
    return { visibility: {}, sections: [] };
  }
}

function isInvestorEsignNestedDocument(doc: Record<string, unknown>): boolean {
  if (String(doc.esignSignatureRequestId ?? "").trim()) return true;
  if (String(doc.esignInvestorRowId ?? "").trim()) return true;
  if (String(doc.esignTemplateFileId ?? "").trim()) return true;
  const lpSectionId = String(doc.lpDisplaySectionId ?? "").trim();
  if (!lpSectionId) return false;
  if (lpSectionId === ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID) return true;
  return lpSectionId.toLowerCase().startsWith("recovered-investor-e-signature");
}

/** Remove investor eSign PDFs from non–e-sign sections (and drop duplicate e-sign section rows). */
export function stripInvestorEsignDocumentsFromOtherSections(
  sections: Record<string, unknown>[],
): Record<string, unknown>[] {
  return sections
    .filter((s) => !isEsignTemplateSection(s))
    .map((s) => {
      const nested = Array.isArray(s.nestedDocuments) ? s.nestedDocuments : [];
      return {
        ...s,
        nestedDocuments: nested.filter((raw) => {
          if (raw == null || typeof raw !== "object") return true;
          const doc = raw as Record<string, unknown>;
          if (String(doc.id ?? "").trim().startsWith("esign-promoted-")) {
            return false;
          }
          return !isInvestorEsignNestedDocument(doc);
        }),
      };
    });
}

/** Move misplaced investor eSign PDFs into the canonical Investor e signatures section. */
export function consolidateInvestorEsignDocumentSections(
  sections: Record<string, unknown>[],
): Record<string, unknown>[] {
  const esignDocsById = new Map<string, Record<string, unknown>>();
  for (const section of sections) {
    const nested = Array.isArray(section.nestedDocuments)
      ? section.nestedDocuments
      : [];
    for (const raw of nested) {
      if (raw == null || typeof raw !== "object") continue;
      const doc = raw as Record<string, unknown>;
      if (!isInvestorEsignNestedDocument(doc)) continue;
      const id = String(doc.id ?? "").trim();
      if (!id) continue;
      esignDocsById.set(id, {
        ...doc,
        lpDisplaySectionId: ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID,
      });
    }
  }

  const stripped = stripInvestorEsignDocumentsFromOtherSections(sections);
  if (esignDocsById.size === 0) return stripped;

  const prior = sections.find(
    (s) => String(s.id ?? "").trim() === ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID,
  );
  stripped.push({
    ...(prior ?? {
      id: ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID,
      sectionLabel: ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL,
      documentLabel: ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL,
      visibility: "Sponsor workspace only",
      sharedWithScope: "not_visible",
      requireLpReview: false,
      dateAdded: formatDdMmmYyyy(new Date()),
    }),
    nestedDocuments: [...esignDocsById.values()],
  });
  return stripped;
}

const ESIGN_STORAGE_URL = /\/e-signed(?:-completed|-preview)?\//i;

function nestedDocHiddenFromPublicOffering(
  doc: Record<string, unknown>,
): boolean {
  if (isInvestorEsignNestedDocument(doc)) return true;
  const id = String(doc.id ?? "").trim();
  if (id.startsWith("esign-promoted-")) return true;
  const url = String(doc.url ?? "").trim();
  return Boolean(url) && ESIGN_STORAGE_URL.test(url);
}

/**
 * Shared offering preview must not include eSign templates or signed packets.
 * Signed copies stay on the investor's own documents when Shared With that investor.
 */
export function stripEsignDocumentsFromPublicOfferingPreview(
  json: string | null | undefined,
): string | null {
  if (!json?.trim()) return json ?? null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const { visibility, sections } = readPreviewParts(json);
    const nextSections = sections
      .filter((section) => !isEsignTemplateSection(section))
      .map((section) => {
        const nested = Array.isArray(section.nestedDocuments)
          ? section.nestedDocuments
          : [];
        return {
          ...section,
          nestedDocuments: nested.filter((raw) => {
            if (raw == null || typeof raw !== "object") return true;
            return !nestedDocHiddenFromPublicOffering(
              raw as Record<string, unknown>,
            );
          }),
        };
      });
    return sanitizeOfferingInvestorPreviewBody({
      visibility: parsed.visibility ?? visibility,
      sections: nextSections,
    });
  } catch {
    return json;
  }
}

function isEsignTemplateSection(section: Record<string, unknown>): boolean {
  const id = String(section.id ?? "").trim();
  if (id === ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID) return true;
  const idLower = id.toLowerCase();
  if (idLower.startsWith("recovered-investor-e-signature")) return true;
  const label = String(section.sectionLabel ?? section.label ?? "")
    .trim()
    .toLowerCase();
  return (
    label === ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL.toLowerCase() ||
    label === LEGACY_ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL.toLowerCase()
  );
}

const NO_PENDING_SPONSOR_AUDIENCE = {
  openToAnySponsor: false,
  pendingNamedSponsorEmails: [] as string[],
};

export async function resolveEsignSponsorSignState(
  send: StoredDealInvestorEsignSend,
): Promise<{
  awaitingSponsorSignature: boolean;
  sponsorSigned: boolean;
  /** Parallel, or sequential sponsor-first: sponsor may sign before the investor. */
  sponsorMaySignBeforeInvestor: boolean;
  /** Unsigned generic Sponsor slot — every deal sponsor may sign. */
  openToAnySponsor: boolean;
  /** Unsigned slots assigned to specific sponsors. */
  pendingNamedSponsorEmails: string[];
}> {
  const investorSignedLocal = esignSendReadyForSponsorCounterSign(send);
  const fullyCompleted = Boolean(send.completedAt?.trim());
  if (fullyCompleted) {
    return {
      awaitingSponsorSignature: false,
      sponsorSigned: true,
      sponsorMaySignBeforeInvestor: false,
      ...NO_PENDING_SPONSOR_AUDIENCE,
    };
  }

  const sigId = send.signatureRequestId?.trim();
  if (!sigId || getActiveEsignProvider() !== "signflow") {
    if (!investorSignedLocal) {
      return {
        awaitingSponsorSignature: false,
        sponsorSigned: fullyCompleted,
        sponsorMaySignBeforeInvestor: false,
        ...NO_PENDING_SPONSOR_AUDIENCE,
      };
    }
    return {
      awaitingSponsorSignature: !fullyCompleted,
      sponsorSigned: fullyCompleted,
      sponsorMaySignBeforeInvestor: false,
      ...NO_PENDING_SPONSOR_AUDIENCE,
    };
  }

  try {
    const doc = await getSignFlowDocument(sigId);
    const workflowType = String(doc.workflowType ?? "")
      .trim()
      .toLowerCase();
    const sponsorRecipient = (doc.recipients ?? []).find((recipient) => {
      const role = String(recipient.role ?? "").trim().toLowerCase();
      const id = String(recipient.id ?? "").trim().toLowerCase();
      return (
        role.includes("sponsor") ||
        role.includes("seller") ||
        id === "rec_sponsor" ||
        id === "rec_2"
      );
    });
    const investorOrders = (doc.recipients ?? [])
      .filter((recipient) => {
        const role = String(recipient.role ?? "").trim().toLowerCase();
        const id = String(recipient.id ?? "").trim().toLowerCase();
        return (
          role.includes("investor") ||
          role.includes("buyer") ||
          id === "rec_investor" ||
          id === "rec_1"
        );
      })
      .map((recipient) => Number(recipient.order) || 1);
    const sponsorOrder = Number(sponsorRecipient?.order) || 0;
    const sameSigningTurn =
      investorOrders.length > 0 &&
      sponsorOrder > 0 &&
      investorOrders.every((order) => order === sponsorOrder);
    const sponsorMaySignBeforeInvestor =
      workflowType === "parallel" ||
      sameSigningTurn ||
      signFlowSponsorSignsBeforeInvestor(doc);
    const audience = signFlowPendingSponsorSignAudience(doc);
    if (!signFlowTemplateHasSponsorFields(doc) || audience.allSponsorSlotsSigned) {
      return {
        awaitingSponsorSignature: false,
        sponsorSigned: true,
        sponsorMaySignBeforeInvestor: false,
        ...NO_PENDING_SPONSOR_AUDIENCE,
      };
    }

    const investorSignedLive =
      investorSignedLocal || signFlowInvestorPhaseComplete(doc);
    const stillWaitingForInvestor =
      !sponsorMaySignBeforeInvestor && !investorSignedLive;

    return {
      awaitingSponsorSignature: !stillWaitingForInvestor,
      sponsorSigned: false,
      sponsorMaySignBeforeInvestor,
      openToAnySponsor: audience.openToAnySponsor,
      pendingNamedSponsorEmails: audience.namedEmails,
    };
  } catch {
    if (!investorSignedLocal) {
      return {
        awaitingSponsorSignature: false,
        sponsorSigned: fullyCompleted,
        sponsorMaySignBeforeInvestor: false,
        ...NO_PENDING_SPONSOR_AUDIENCE,
      };
    }
    return {
      awaitingSponsorSignature: !fullyCompleted,
      sponsorSigned: fullyCompleted,
      sponsorMaySignBeforeInvestor: false,
      ...NO_PENDING_SPONSOR_AUDIENCE,
    };
  }
}

function sendReadyForInvestorEsignDocumentsSection(
  send: StoredDealInvestorEsignSend,
): boolean {
  return esignSendReadyForSponsorCounterSign(send);
}

/** Deal template is parallel, so the sponsor may open this sent copy before the investor. */
function sendTemplateIsParallel(
  send: StoredDealInvestorEsignSend,
  templates: EsignTemplatesJson | null,
): boolean {
  if (!templates) return false;
  for (const doc of send.documents ?? []) {
    const fileId = doc.fileId?.trim();
    if (!fileId) continue;
    const file = findEsignTemplateFile(templates, fileId);
    if (!file) continue;
    if (resolveEsignSignflowWorkflowType(file) === "parallel") return true;
  }
  return false;
}

function buildEsignNestedDocument(params: {
  docId: string;
  displayName: string;
  url: string;
  dateAdded: string;
  investorRowId: string;
  investorRowTable: "investment" | "lp";
  signatureRequestId: string;
  templateFileId: string;
  awaitingSponsorSignature: boolean;
  sponsorSigned: boolean;
  openToAnySponsor: boolean;
  pendingNamedSponsorEmails: string[];
}): Record<string, unknown> {
  return {
    id: params.docId,
    name: params.displayName,
    url: params.url,
    dateAdded: params.dateAdded,
    lpDisplaySectionId: ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID,
    sharedDealClassIds: [],
    sharedInvestorIds: [],
    sharedWithAllInvestors: false,
    sharedSponsorUserIds: [],
    sharedWithScope: "not_visible",
    requiresProfileInvestment: false,
    esignSignatureRequestId: params.signatureRequestId || undefined,
    esignInvestorRowId: params.investorRowId,
    esignInvestorRowTable: params.investorRowTable,
    esignTemplateFileId: params.templateFileId || undefined,
    esignAwaitingSponsorSignature: params.awaitingSponsorSignature,
    esignSponsorSigned: params.sponsorSigned,
    ...(params.openToAnySponsor ? { esignOpenSponsorSign: true } : {}),
    ...(params.pendingNamedSponsorEmails.length > 0
      ? { esignSponsorSignerEmails: params.pendingNamedSponsorEmails }
      : {}),
  };
}

async function collectCompletedEsignNestedDocuments(
  dealId: string,
  investorRowId: string,
  investorRowTable: "investment" | "lp",
  investorDisplayName: string,
  profileId: string | null | undefined,
  esignStatusJson: string | null | undefined,
  sponsorDocsGateOpen: boolean,
  templates: EsignTemplatesJson | null,
): Promise<Record<string, unknown>[]> {
  const bundle = parseEsignStatusBundle(esignStatusJson);
  if (!bundle?.sends.length) return [];
  if (!sponsorDocsGateOpen) return [];

  const investorLabel = investorDisplayName.trim() || "Investor";
  const profileLabel = commitmentProfileDisplayLabel(profileId);
  const out: Record<string, unknown>[] = [];

  for (const send of bundle.sends) {
    const sig = send.signatureRequestId?.trim() ?? "";
    const sponsorState = await resolveEsignSponsorSignState(send);
    const investorPacketReady = sendReadyForInvestorEsignDocumentsSection(send);
    const parallelTemplate = sendTemplateIsParallel(send, templates);
    const sponsorCanOpenNow =
      sponsorState.sponsorMaySignBeforeInvestor ||
      (parallelTemplate && !sponsorState.sponsorSigned);
    if (!investorPacketReady && !sponsorCanOpenNow) {
      continue;
    }
    if (!investorPacketReady && !send.sentAt?.trim()) continue;
    let sendForView = send;
    if (
      sponsorState.sponsorSigned &&
      sig &&
      getActiveEsignProvider() === "signflow"
    ) {
      sendForView = await ensureSponsorSignedPdfForDocumentsView({
        dealId,
        rosterId: investorRowId,
        investorRowTable,
        signatureRequestId: sig,
        send,
        investorPacketReady,
      });
    }
    const signedDocs = investorPacketReady
      ? listSignedEsignDocumentsForSend(sendForView, sig, {
          preferFullSignedCopy: sponsorState.sponsorSigned,
        })
      : listPendingEsignDocumentsForSponsor(sendForView, sig);
    const completedAt =
      send.signedAt?.trim() ||
      send.completedAt?.trim() ||
      send.sentAt?.trim() ||
      "";
    const dateAdded = formatDdMmmYyyy(completedAt);

    for (const doc of signedDocs) {
      const url = doc.url?.trim() ?? "";
      if (!url && !sponsorCanOpenNow) continue;
      const docId = doc.fileId.trim();
      if (!docId) continue;
      const templateName = doc.name.trim() || "Signed document";
      const displayName = `${templateName} - ${investorLabel} - ${profileLabel}`;
      const templateFileId = docId.includes("::")
        ? docId.split("::").pop()?.trim() ?? docId
        : docId;
      out.push(
        buildEsignNestedDocument({
          docId,
          displayName,
          url,
          dateAdded,
          investorRowId,
          investorRowTable,
          signatureRequestId: sig,
          templateFileId,
          awaitingSponsorSignature:
            sponsorState.awaitingSponsorSignature ||
            (sponsorCanOpenNow && !sponsorState.sponsorSigned),
          sponsorSigned: sponsorState.sponsorSigned,
          openToAnySponsor: sponsorState.openToAnySponsor,
          pendingNamedSponsorEmails: sponsorState.pendingNamedSponsorEmails,
        }),
      );
    }
  }

  return out;
}

/**
 * Rebuild the Investor e signatures section from completed investor eSign rows.
 * Signed PDFs stay in that section and are not copied into General.
 * Returns true when `offering_investor_preview_json` was updated.
 */
export async function syncCompletedEsignDocumentsToDocumentsTab(
  dealId: string,
): Promise<boolean> {
  const id = dealId.trim();
  if (!id) return false;

  const deal = await getAddDealFormById(id);
  if (!deal) return false;

  const [investments, roster] = await Promise.all([
    db
      .select({
        id: dealInvestment.id,
        contactDisplayName: dealInvestment.contactDisplayName,
        profileId: dealInvestment.profileId,
        esignStatusJson: dealInvestment.esignStatusJson,
      })
      .from(dealInvestment)
      .where(eq(dealInvestment.dealId, id)),
    db
      .select({
        id: dealLpInvestor.id,
        email: dealLpInvestor.email,
        profileId: dealLpInvestor.profileId,
        esignStatusJson: dealLpInvestor.esignStatusJson,
      })
      .from(dealLpInvestor)
      .where(eq(dealLpInvestor.dealId, id)),
  ]);

  const sponsorDocsGateOpen = await sequentialWorkflowSponsorDocsGateOpen(id);
  const templates = await getDealEsignTemplatesState(id).catch(() => null);

  const nestedById = new Map<string, Record<string, unknown>>();
  for (const row of investments) {
    const docs = await collectCompletedEsignNestedDocuments(
      id,
      row.id,
      "investment",
      row.contactDisplayName ?? "",
      row.profileId,
      row.esignStatusJson,
      sponsorDocsGateOpen,
      templates,
    );
    for (const doc of docs) {
      const docId = String(doc.id ?? "").trim();
      if (docId) nestedById.set(docId, doc);
    }
  }
  for (const row of roster) {
    const docs = await collectCompletedEsignNestedDocuments(
      id,
      row.id,
      "lp",
      row.email?.trim() ?? "",
      row.profileId,
      row.esignStatusJson,
      sponsorDocsGateOpen,
      templates,
    );
    for (const doc of docs) {
      const docId = String(doc.id ?? "").trim();
      if (docId) nestedById.set(docId, doc);
    }
  }

  const { visibility, sections: existingSections } = readPreviewParts(
    deal.offeringInvestorPreviewJson,
  );
  const otherSections = stripInvestorEsignDocumentsFromOtherSections(
    existingSections,
  );

  const esignNested = [...nestedById.values()];
  const hadEsignSection = existingSections.some(isEsignTemplateSection);

  let nextSections = [...otherSections];
  if (esignNested.length > 0 || hadEsignSection) {
    nextSections.push({
      id: ESIGN_TEMPLATE_DOCUMENTS_SECTION_ID,
      sectionLabel: ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL,
      documentLabel: ESIGN_TEMPLATE_DOCUMENTS_SECTION_LABEL,
      visibility: "Sponsor workspace only",
      sharedWithScope: "not_visible",
      requireLpReview: false,
      dateAdded: formatDdMmmYyyy(new Date()),
      nestedDocuments: esignNested,
    });
  }

  const canonical = sanitizeOfferingInvestorPreviewBody({
    visibility,
    sections: nextSections,
  });

  if (canonical === (deal.offeringInvestorPreviewJson ?? "")) return false;

  const updated = await updateDealOfferingInvestorPreviewById(id, canonical);
  return Boolean(updated);
}

/**
 * True when this profile-scoped signature request already appears in the sponsor
 * Documents tab “Investor e signatures” section (authoritative for sponsor counter-sign).
 */
export async function esignSignatureRequestVisibleInDocumentsTab(
  dealId: string,
  signatureRequestId: string,
): Promise<boolean> {
  const id = dealId.trim();
  const sigId = signatureRequestId.trim();
  if (!id || !sigId) return false;

  const deal = await getAddDealFormById(id);
  const { sections } = readPreviewParts(deal?.offeringInvestorPreviewJson);
  for (const section of sections) {
    if (!isEsignTemplateSection(section)) continue;
    const nested = section.nestedDocuments;
    if (!Array.isArray(nested)) continue;
    for (const raw of nested) {
      if (raw == null || typeof raw !== "object") continue;
      const doc = raw as Record<string, unknown>;
      const docSig = String(doc.esignSignatureRequestId ?? "").trim();
      if (docSig === sigId) return true;
      const docId = String(doc.id ?? "").trim();
      if (docId === sigId || docId.startsWith(`${sigId}::`)) return true;
    }
  }
  return false;
}

/** Latest canonical JSON after sync (for API responses). */
export async function readOfferingInvestorPreviewJsonAfterEsignSync(
  dealId: string,
): Promise<string | null> {
  const id = dealId.trim();
  if (!id) return null;
  await syncCompletedEsignDocumentsToDocumentsTab(id);
  const deal = await getAddDealFormById(id);
  return deal?.offeringInvestorPreviewJson ?? null;
}
