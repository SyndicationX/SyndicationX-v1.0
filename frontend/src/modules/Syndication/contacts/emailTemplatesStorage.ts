/** Backend-backed persistence for email templates. */
import { portalAuthHeaders } from "../../../common/auth/portalAuthHeaders"
import { getApiV1Base } from "../../../common/utils/apiBaseUrl"

export const EMAIL_TEMPLATE_SUBJECT_MAX = 255
/** Stored body is semantic HTML from Quill. */
export const EMAIL_TEMPLATE_BODY_HTML_MAX = 200_000
/** Single attachment per template; max file size. */
export const EMAIL_TEMPLATE_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024

/** Human-readable attachment size for UI labels. */
export function formatEmailAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type EmailTemplateAttachmentStored = {
  fileName: string
  mimeType: string
  size: number
  /** Raw base64 payload (no data: prefix). */
  dataBase64: string
}

export type EmailTemplateRow = {
  id: string
  name: string
  subject: string
  body: string
  attachment: EmailTemplateAttachmentStored | null
  /** When true, template appears under Archived */
  archived?: boolean
  createdBy: string
  createdAt: string
  /**
   * False when the row is a dropdown summary (no body, no attachment bytes).
   * Omitted or true means the body is already loaded.
   */
  contentLoaded?: boolean
}

function coerceRow(raw: Record<string, unknown>): EmailTemplateRow | null {
  const id = typeof raw.id === "string" ? raw.id : ""
  if (!id) return null
  const nameRaw = typeof raw.name === "string" ? raw.name.trim() : ""
  const name = nameRaw || "Untitled"
  const subject =
    typeof raw.subject === "string" ? raw.subject.slice(0, EMAIL_TEMPLATE_SUBJECT_MAX) : ""
  const body =
    typeof raw.body === "string"
      ? raw.body.slice(0, EMAIL_TEMPLATE_BODY_HTML_MAX)
      : ""
  let attachment: EmailTemplateAttachmentStored | null = null
  const att = raw.attachment
  if (att && typeof att === "object" && att !== null) {
    const o = att as Record<string, unknown>
    const fileName = typeof o.fileName === "string" ? o.fileName : ""
    const mimeType = typeof o.mimeType === "string" ? o.mimeType : ""
    const size = typeof o.size === "number" ? o.size : 0
    const dataBase64 = typeof o.dataBase64 === "string" ? o.dataBase64 : ""
    if (fileName && dataBase64)
      attachment = { fileName, mimeType, size, dataBase64 }
  }
  const createdBy =
    typeof raw.createdBy === "string" ? raw.createdBy : "—"
  const createdAt =
    typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString()
  const archived =
    typeof raw.archived === "boolean" ? raw.archived : false
  const contentLoaded = raw.contentLoaded !== false
  return {
    id,
    name,
    subject,
    body,
    attachment,
    archived,
    createdBy,
    createdAt,
    contentLoaded,
  }
}

const EMAIL_TEMPLATE_SUMMARY_TTL_MS = 60_000
let summaryCache: { at: number; rows: EmailTemplateRow[] } | null = null
const detailCache = new Map<string, EmailTemplateRow>()

function invalidateEmailTemplateCache(): void {
  summaryCache = null
  detailCache.clear()
}

export function peekActiveEmailTemplateSummaries(): EmailTemplateRow[] | null {
  if (!summaryCache) return null
  if (Date.now() - summaryCache.at > EMAIL_TEMPLATE_SUMMARY_TTL_MS) return null
  return summaryCache.rows.filter((row) => !row.archived)
}

function authHeaders(): HeadersInit {
  return portalAuthHeaders()
}

function normalizeEmailTemplateRow(raw: Record<string, unknown>): EmailTemplateRow | null {
  return coerceRow(raw)
}

export async function loadEmailTemplates(options?: {
  /** Names and subjects only. Body and attachments load on preview or send. */
  summary?: boolean
}): Promise<EmailTemplateRow[]> {
  const summary = options?.summary === true
  if (
    summary &&
    summaryCache &&
    Date.now() - summaryCache.at < EMAIL_TEMPLATE_SUMMARY_TTL_MS
  ) {
    return summaryCache.rows
  }
  const base = getApiV1Base()
  if (!base) return []
  try {
    const qs = summary ? "?summary=1" : ""
    const res = await fetch(`${base}/contacts/email-templates${qs}`, {
      headers: { ...authHeaders() },
      credentials: "include",
      /** After create/edit, always read the latest templates from API. */
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = (await res.json().catch(() => ({}))) as { templates?: unknown }
    if (!Array.isArray(data.templates)) return []
    const out: EmailTemplateRow[] = []
    for (const item of data.templates) {
      if (item && typeof item === "object") {
        const row = normalizeEmailTemplateRow(item as Record<string, unknown>)
        if (row) out.push(row)
      }
    }
    if (summary) summaryCache = { at: Date.now(), rows: out }
    return out
  } catch {
    return []
  }
}

/** Body and attachment for one template. Summaries stay in the dropdown cache. */
export async function ensureEmailTemplateContent(
  row: EmailTemplateRow,
): Promise<EmailTemplateRow | null> {
  if (row.contentLoaded !== false) return row
  const cached = detailCache.get(row.id)
  if (cached) return cached
  const base = getApiV1Base()
  if (!base) return null
  try {
    const res = await fetch(
      `${base}/contacts/email-templates/${encodeURIComponent(row.id)}`,
      {
        headers: { ...authHeaders() },
        credentials: "include",
        cache: "no-store",
      },
    )
    if (!res.ok) return null
    const data = (await res.json().catch(() => ({}))) as { template?: unknown }
    const template = data.template
    if (!template || typeof template !== "object") return null
    const full = normalizeEmailTemplateRow(template as Record<string, unknown>)
    if (!full) return null
    const loaded = { ...full, contentLoaded: true as const }
    detailCache.set(row.id, loaded)
    return loaded
  } catch {
    return null
  }
}

export function prefetchEmailTemplateContent(
  row: EmailTemplateRow | null | undefined,
): void {
  if (!row || row.contentLoaded !== false) return
  void ensureEmailTemplateContent(row)
}

export async function appendEmailTemplate(row: EmailTemplateRow): Promise<void> {
  invalidateEmailTemplateCache()
  const base = getApiV1Base()
  if (!base) throw new Error("API is not configured (VITE_BASE_URL).")
  const res = await fetch(`${base}/contacts/email-templates`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    /**
     * Template save uses Bearer auth only. Some environments reject cookie-attached
     * unsafe methods with 403, so omit cookies explicitly here.
     */
    credentials: "omit",
    body: JSON.stringify({
      name: row.name,
      subject: row.subject,
      body: row.body,
      attachment: row.attachment,
      archived: Boolean(row.archived),
    }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: unknown }
    const msg = data.message != null ? String(data.message) : "Could not save template."
    throw new Error(msg)
  }
}

export async function getEmailTemplateById(id: string): Promise<EmailTemplateRow | undefined> {
  const row = await ensureEmailTemplateContent({
    id,
    name: "",
    subject: "",
    body: "",
    attachment: null,
    createdBy: "",
    createdAt: "",
    contentLoaded: false,
  })
  return row ?? undefined
}

/** Replaces the row with the same `id` if it exists. */
export async function updateEmailTemplate(row: EmailTemplateRow): Promise<boolean> {
  invalidateEmailTemplateCache()
  const base = getApiV1Base()
  if (!base) throw new Error("API is not configured (VITE_BASE_URL).")
  const res = await fetch(
    `${base}/contacts/email-templates/${encodeURIComponent(row.id)}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      /**
       * Template update uses Bearer auth only. Omitting cookies avoids 403s from
       * CSRF-style edge policies in some deployments.
       */
      credentials: "omit",
      body: JSON.stringify({
        name: row.name,
        subject: row.subject,
        body: row.body,
        attachment: row.attachment,
        archived: Boolean(row.archived),
      }),
    },
  )
  if (res.status === 404) return false
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: unknown }
    const msg = data.message != null ? String(data.message) : "Could not update template."
    throw new Error(msg)
  }
  return true
}

export async function deleteEmailTemplate(id: string): Promise<boolean> {
  invalidateEmailTemplateCache()
  const base = getApiV1Base()
  if (!base || !id.trim()) return false
  try {
    const res = await fetch(
      `${base}/contacts/email-templates/${encodeURIComponent(id.trim())}`,
      {
        method: "DELETE",
        headers: { ...authHeaders() },
        credentials: "omit",
      },
    )
    return res.ok
  } catch {
    return false
  }
}

export function fileToStoredAttachment(
  file: File,
): Promise<
  | { ok: true; data: EmailTemplateAttachmentStored }
  | { ok: false; error: string }
> {
  if (file.size > EMAIL_TEMPLATE_ATTACHMENT_MAX_BYTES) {
    return Promise.resolve({
      ok: false,
      error: "Attachment must be 30 MB or smaller.",
    })
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        resolve({ ok: false, error: "Could not read file." })
        return
      }
      const comma = result.indexOf(",")
      const base64 = comma >= 0 ? result.slice(comma + 1) : result
      resolve({
        ok: true,
        data: {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataBase64: base64,
        },
      })
    }
    reader.onerror = () =>
      resolve({ ok: false, error: "Could not read file." })
    reader.readAsDataURL(file)
  })
}

/** Build a temporary object URL for preview/download (caller should revoke). */
export function attachmentToObjectUrl(
  att: EmailTemplateAttachmentStored,
): string {
  try {
    const bin = atob(att.dataBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: att.mimeType })
    return URL.createObjectURL(blob)
  } catch {
    return ""
  }
}
