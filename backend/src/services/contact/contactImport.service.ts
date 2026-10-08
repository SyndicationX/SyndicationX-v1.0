import { and, eq, isNull, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../../database/db.js";
import {
  contact,
  contactImportBatch,
  contactImportRow,
  type ContactImportCounts,
  type ContactImportRowRow,
  type ContactRow,
} from "../../schema/contact.schema.js";
import { canonicalUsPhoneKey10, parseUsPhoneToE164 } from "../../utils/usPhone.js";
import { resolveOrganizationIdForUserId } from "../org/orgResolution.service.js";
import {
  getUserDisplayNameById,
  insertContact,
  updateContactFieldsForViewer,
} from "./contact.service.js";

export type ContactImportFileType = "csv" | "excel";
export type ContactImportDuplicateMode = "skip" | "update";

export type ContactImportField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "note"
  | "tags"
  | "lists";

export type ContactImportMapping = Partial<Record<ContactImportField, string | null>>;

export type ContactImportPreviewRow = {
  id: string;
  rowIndex: number;
  raw: Record<string, string>;
  normalized: NormalizedImportContact | null;
  errors: string[];
  status: "valid" | "invalid" | "duplicate" | "imported" | "skipped" | "updated";
  duplicateContactId: string | null;
  duplicateMatch: "email" | "phone" | null;
};

export type ContactImportParseResult = {
  batchId: string;
  headers: string[];
  suggestedMapping: ContactImportMapping;
  sampleRows: Record<string, string>[];
  totalRows: number;
};

export type ContactImportPreviewResult = {
  batchId: string;
  counts: ContactImportCounts;
  rows: ContactImportPreviewRow[];
};

export type ContactImportConfirmResult = ContactImportPreviewResult & {
  importedContactIds: string[];
};

type NormalizedImportContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  note: string;
  tags: string[];
  lists: string[];
  owners: string[];
  mappedFields: ContactImportField[];
};

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2_000;
const PREVIEW_LIMIT = 100;

const FIELD_LABELS: Record<ContactImportField, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  fullName: "Full Name",
  email: "Email",
  phone: "Phone",
  note: "Note",
  tags: "Tags",
  lists: "Lists",
};

const FIELD_ALIASES: Record<ContactImportField, string[]> = {
  firstName: ["first name", "firstname", "first", "fname", "given name"],
  lastName: ["last name", "lastname", "last", "lname", "surname", "family name"],
  fullName: ["full name", "fullname", "name", "contact name"],
  email: ["email", "email address", "e-mail", "mail"],
  phone: ["phone", "mobile", "mobile number", "phone number", "cell", "cell phone"],
  note: ["note", "notes", "comments", "comment"],
  tags: ["tags", "contact tags", "tag"],
  lists: ["lists", "list"],
};

function cleanHeader(value: unknown, fallbackIndex: number): string {
  const s = String(value ?? "").trim();
  return s || `Column ${fallbackIndex + 1}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = cleanHeader(header, index);
    const key = base.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(buffer: Buffer): string[][] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let line = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        line += ch + text[i + 1];
        i += 1;
      } else {
        inQuotes = !inQuotes;
        line += ch;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      rows.push(parseCsvLine(line));
      line = "";
    } else {
      line += ch;
    }
  }
  if (line || text.endsWith(",")) rows.push(parseCsvLine(line));
  return rows;
}

function parseWorkbook(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  }).map((row) => row.map(cellToString));
}

function rowsToObjects(matrix: string[][]): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const firstNonEmpty = matrix.findIndex((row) =>
    row.some((cell) => String(cell ?? "").trim()),
  );
  if (firstNonEmpty < 0) return { headers: [], rows: [] };
  const headers = dedupeHeaders(matrix[firstNonEmpty]!.map(cleanHeader));
  const rows = matrix
    .slice(firstNonEmpty + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = cellToString(row[index]);
      });
      return obj;
    });
  return { headers, rows };
}

function inferFileType(fileName: string, mimeType: string): ContactImportFileType {
  const lower = fileName.toLowerCase();
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel")
  ) {
    return "excel";
  }
  return "csv";
}

function suggestMapping(headers: string[]): ContactImportMapping {
  const normalizedHeaders = headers.map((header) => ({
    header,
    key: normalizeKey(header),
  }));
  const mapping: ContactImportMapping = {};
  const used = new Set<string>();
  for (const field of Object.keys(FIELD_LABELS) as ContactImportField[]) {
    const aliases = FIELD_ALIASES[field].map(normalizeKey);
    const exact = normalizedHeaders.find(
      (h) => !used.has(h.header) && aliases.includes(h.key),
    );
    const loose =
      exact ??
      normalizedHeaders.find(
        (h) =>
          !used.has(h.header) &&
          aliases.some((alias) => h.key.includes(alias) || alias.includes(h.key)),
      );
    if (loose) {
      mapping[field] = loose.header;
      used.add(loose.header);
    }
  }
  if (!mapping.firstName && !mapping.lastName && mapping.fullName) {
    mapping.firstName = null;
    mapping.lastName = null;
  }
  return mapping;
}

function mappedValue(
  raw: Record<string, string>,
  mapping: ContactImportMapping,
  field: ContactImportField,
): string {
  const header = mapping[field];
  return header ? String(raw[header] ?? "").trim() : "";
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "",
  };
}

function splitMultiValue(raw: string): string[] {
  return raw
    .split(/[;,|]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeMappedRow(
  raw: Record<string, string>,
  mapping: ContactImportMapping,
  defaultOwner: string,
): { normalized: NormalizedImportContact | null; errors: string[] } {
  const mappedFields = (Object.keys(mapping) as ContactImportField[]).filter(
    (field) => Boolean(mapping[field]),
  );
  const fullName = mappedValue(raw, mapping, "fullName");
  const split = splitName(fullName);
  const firstName = mappedValue(raw, mapping, "firstName") || split.firstName;
  const lastName = mappedValue(raw, mapping, "lastName") || split.lastName;
  const email = mappedValue(raw, mapping, "email").toLowerCase();
  const phoneRaw = mappedValue(raw, mapping, "phone");
  const phone = phoneRaw ? parseUsPhoneToE164(phoneRaw) : "";
  const errors: string[] = [];

  if (!firstName) errors.push("First name is required.");
  if (!email) {
    errors.push("Email is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email format is invalid.");
  }
  if (phoneRaw && !phone) errors.push("Phone must be a valid 10-digit U.S. number.");

  const normalized: NormalizedImportContact = {
    firstName,
    lastName,
    email,
    phone: phone ?? "",
    note: mappedValue(raw, mapping, "note"),
    tags: splitMultiValue(mappedValue(raw, mapping, "tags")),
    lists: splitMultiValue(mappedValue(raw, mapping, "lists")),
    owners: defaultOwner ? [defaultOwner] : [],
    mappedFields,
  };

  return { normalized: errors.length > 0 ? null : normalized, errors };
}

async function findDuplicateContact(params: {
  userId: string;
  organizationId: string | null;
  normalized: NormalizedImportContact;
}): Promise<{ contact: ContactRow; match: "email" | "phone" } | null> {
  const email = params.normalized.email.trim().toLowerCase();
  const phoneKey = canonicalUsPhoneKey10(params.normalized.phone);
  const scope = params.organizationId
    ? eq(contact.organizationId, params.organizationId)
    : and(isNull(contact.organizationId), eq(contact.createdBy, params.userId));
  const matches = await db
    .select()
    .from(contact)
    .where(
      and(
        scope,
        sql`(
          lower(trim(${contact.email})) = ${email}
          OR (
            ${phoneKey} <> ''
            AND right(regexp_replace(coalesce(${contact.phone}, ''), '[^0-9]', '', 'g'), 10) = ${phoneKey}
          )
        )`,
      ),
    )
    .limit(1);
  const row = matches[0];
  if (!row) return null;
  const match =
    row.email.trim().toLowerCase() === email ? "email" : "phone";
  return { contact: row, match };
}

function emptyCounts(totalRows: number): ContactImportCounts {
  return {
    totalRows,
    newRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
    importedRows: 0,
    skippedRows: 0,
    updatedRows: 0,
  };
}

function rowToPreview(row: ContactImportRowRow): ContactImportPreviewRow {
  return {
    id: row.id,
    rowIndex: row.rowIndex,
    raw: row.raw ?? {},
    normalized: (row.normalized as NormalizedImportContact | null) ?? null,
    errors: row.errors ?? [],
    status: row.status as ContactImportPreviewRow["status"],
    duplicateContactId: row.duplicateContactId ?? null,
    duplicateMatch: (row.duplicateMatch as "email" | "phone" | null) ?? null,
  };
}

async function loadOwnedBatch(batchId: string, userId: string) {
  const [batch] = await db
    .select()
    .from(contactImportBatch)
    .where(and(eq(contactImportBatch.id, batchId), eq(contactImportBatch.createdBy, userId)))
    .limit(1);
  return batch ?? null;
}

export async function parseContactImportFile(params: {
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ContactImportParseResult> {
  if (!params.buffer.length) throw new Error("Upload a CSV or Excel file.");
  if (params.buffer.length > MAX_IMPORT_BYTES) {
    throw new Error("Import file is too large. Use a file under 8 MB.");
  }
  const fileType = inferFileType(params.fileName, params.mimeType);
  const matrix =
    fileType === "excel" ? parseWorkbook(params.buffer) : parseCsv(params.buffer);
  const { headers, rows } = rowsToObjects(matrix);
  if (headers.length === 0) throw new Error("No header row found in the file.");
  if (rows.length === 0) throw new Error("No contact rows found in the file.");

  const organizationId = await resolveOrganizationIdForUserId(params.userId);
  const suggestedMapping = suggestMapping(headers);
  const [batch] = await db
    .insert(contactImportBatch)
    .values({
      organizationId: organizationId ?? null,
      createdBy: params.userId,
      fileName: params.fileName,
      fileType,
      headers,
      mapping: suggestedMapping,
      counts: emptyCounts(rows.length),
    })
    .returning();
  if (!batch) throw new Error("Could not create import batch.");

  await db.insert(contactImportRow).values(
    rows.map((row, index) => ({
      batchId: batch.id,
      rowIndex: index + 2,
      raw: row,
      normalized: null,
      errors: [],
      status: "parsed",
    })),
  );

  return {
    batchId: batch.id,
    headers,
    suggestedMapping,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
  };
}

export async function previewContactImport(params: {
  userId: string;
  batchId: string;
  mapping: ContactImportMapping;
}): Promise<ContactImportPreviewResult> {
  const batch = await loadOwnedBatch(params.batchId, params.userId);
  if (!batch) throw new Error("Import batch not found.");

  const rows = await db
    .select()
    .from(contactImportRow)
    .where(eq(contactImportRow.batchId, batch.id));
  const defaultOwner = (await getUserDisplayNameById(params.userId)).trim();
  const counts = emptyCounts(rows.length);
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  for (const row of rows) {
    const { normalized, errors } = normalizeMappedRow(
      row.raw ?? {},
      params.mapping,
      defaultOwner,
    );
    let status: ContactImportPreviewRow["status"] = "valid";
    let duplicateContactId: string | null = null;
    let duplicateMatch: "email" | "phone" | null = null;
    const rowErrors = [...errors];

    if (normalized) {
      const emailKey = normalized.email.trim().toLowerCase();
      const phoneKey = canonicalUsPhoneKey10(normalized.phone);
      if (emailKey && seenEmails.has(emailKey)) {
        rowErrors.push("Duplicate email within this import file.");
      }
      if (phoneKey && seenPhones.has(phoneKey)) {
        rowErrors.push("Duplicate phone within this import file.");
      }
      seenEmails.add(emailKey);
      if (phoneKey) seenPhones.add(phoneKey);
    }

    if (rowErrors.length > 0 || !normalized) {
      status = "invalid";
      counts.invalidRows += 1;
    } else {
      const duplicate = await findDuplicateContact({
        userId: params.userId,
        organizationId: batch.organizationId ?? null,
        normalized,
      });
      if (duplicate) {
        status = "duplicate";
        duplicateContactId = duplicate.contact.id;
        duplicateMatch = duplicate.match;
        counts.duplicateRows += 1;
      } else {
        counts.newRows += 1;
      }
    }

    await db
      .update(contactImportRow)
      .set({
        normalized,
        errors: rowErrors,
        status,
        duplicateContactId,
        duplicateMatch,
      })
      .where(eq(contactImportRow.id, row.id));
  }

  await db
    .update(contactImportBatch)
    .set({
      mapping: params.mapping,
      counts,
      status: "previewed",
      updatedAt: new Date(),
    })
    .where(eq(contactImportBatch.id, batch.id));

  const previewRows = await db
    .select()
    .from(contactImportRow)
    .where(eq(contactImportRow.batchId, batch.id))
    .limit(PREVIEW_LIMIT);

  return {
    batchId: batch.id,
    counts,
    rows: previewRows.map(rowToPreview),
  };
}

async function loadContactById(contactId: string): Promise<ContactRow | null> {
  const [row] = await db
    .select()
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1);
  return row ?? null;
}

function mergeForUpdate(
  existing: ContactRow,
  normalized: NormalizedImportContact,
) {
  const mapped = new Set(normalized.mappedFields);
  return {
    firstName: mapped.has("firstName") || mapped.has("fullName") ? normalized.firstName : existing.firstName,
    lastName: mapped.has("lastName") || mapped.has("fullName") ? normalized.lastName : existing.lastName,
    email: mapped.has("email") ? normalized.email : existing.email,
    phone: mapped.has("phone") ? normalized.phone : existing.phone,
    note: mapped.has("note") ? normalized.note : existing.note,
    tags: mapped.has("tags") ? normalized.tags : existing.tags ?? [],
    lists: mapped.has("lists") ? normalized.lists : existing.lists ?? [],
    owners: normalized.owners,
    lastEditReason: "Updated from contact import",
  };
}

export async function confirmContactImport(params: {
  userId: string;
  batchId: string;
  duplicateMode: ContactImportDuplicateMode;
}): Promise<ContactImportConfirmResult> {
  const batch = await loadOwnedBatch(params.batchId, params.userId);
  if (!batch) throw new Error("Import batch not found.");

  const rows = await db
    .select()
    .from(contactImportRow)
    .where(eq(contactImportRow.batchId, batch.id));
  const counts = emptyCounts(rows.length);
  const importedContactIds: string[] = [];

  for (const row of rows) {
    const normalized = row.normalized as NormalizedImportContact | null;
    if (row.status === "invalid" || !normalized) {
      counts.invalidRows += 1;
      continue;
    }

    if (row.status === "duplicate") {
      counts.duplicateRows += 1;
      if (params.duplicateMode !== "update" || !row.duplicateContactId) {
        counts.skippedRows += 1;
        await db
          .update(contactImportRow)
          .set({ status: "skipped" })
          .where(eq(contactImportRow.id, row.id));
        continue;
      }
      const existing = await loadContactById(row.duplicateContactId);
      if (!existing) {
        counts.skippedRows += 1;
        await db
          .update(contactImportRow)
          .set({ status: "skipped", errors: ["Duplicate contact no longer exists."] })
          .where(eq(contactImportRow.id, row.id));
        continue;
      }
      try {
        const updated = await updateContactFieldsForViewer(
          params.userId,
          existing.id,
          mergeForUpdate(existing, normalized),
        );
        if (!updated) {
          counts.skippedRows += 1;
          await db
            .update(contactImportRow)
            .set({ status: "skipped", errors: ["You do not have access to update this contact."] })
            .where(eq(contactImportRow.id, row.id));
          continue;
        }
        counts.updatedRows += 1;
        importedContactIds.push(updated.id);
        await db
          .update(contactImportRow)
          .set({ status: "updated", importContactId: updated.id })
          .where(eq(contactImportRow.id, row.id));
      } catch (err) {
        counts.invalidRows += 1;
        const message =
          err instanceof Error ? err.message : "Could not update this duplicate.";
        await db
          .update(contactImportRow)
          .set({ status: "invalid", errors: [message] })
          .where(eq(contactImportRow.id, row.id));
      }
      continue;
    }

    counts.newRows += 1;
    try {
      const inserted = await insertContact({
        input: {
          firstName: normalized.firstName,
          lastName: normalized.lastName,
          email: normalized.email,
          phone: normalized.phone,
          note: normalized.note,
          tags: normalized.tags,
          lists: normalized.lists,
          owners: normalized.owners,
          importSource: batch.fileType === "excel" ? "excel" : "csv",
        },
        createdByUserId: params.userId,
      });
      counts.importedRows += 1;
      importedContactIds.push(inserted.id);
      await db
        .update(contactImportRow)
        .set({ status: "imported", importContactId: inserted.id })
        .where(eq(contactImportRow.id, row.id));
    } catch (err) {
      counts.invalidRows += 1;
      const message =
        err instanceof Error ? err.message : "Could not import this row.";
      await db
        .update(contactImportRow)
        .set({ status: "invalid", errors: [message] })
        .where(eq(contactImportRow.id, row.id));
    }
  }

  await db
    .update(contactImportBatch)
    .set({
      duplicateMode: params.duplicateMode,
      counts,
      status: "imported",
      updatedAt: new Date(),
    })
    .where(eq(contactImportBatch.id, batch.id));

  const previewRows = await db
    .select()
    .from(contactImportRow)
    .where(eq(contactImportRow.batchId, batch.id))
    .limit(PREVIEW_LIMIT);

  return {
    batchId: batch.id,
    counts,
    importedContactIds,
    rows: previewRows.map(rowToPreview),
  };
}
