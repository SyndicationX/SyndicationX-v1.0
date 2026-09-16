import { portalAuthHeaders } from "@/common/auth/portalAuthHeaders"
import { getApiV1Base } from "@/common/utils/apiBaseUrl"
import type {
  FeedbackAlertKind,
  FeedbackItem,
  FeedbackPageOption,
  FeedbackReviewAction,
  FeedbackStatus,
} from "../types"

export const FEEDBACK_PENDING_CHANGED_EVENT =
  "syndicationx:feedback-pending-changed"

export function notifyFeedbackPendingChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(FEEDBACK_PENDING_CHANGED_EVENT))
}

function authHeaders(): HeadersInit {
  return portalAuthHeaders()
}

function messageFromBody(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const m = (data as { message?: unknown }).message
    if (typeof m === "string" && m.trim()) return m.trim()
  }
  return fallback
}

function asFeedback(raw: unknown): FeedbackItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = String(r.id ?? "").trim()
  if (!id) return null
  const statusRaw = String(r.status ?? "Pending").trim()
  const status: FeedbackStatus =
    statusRaw === "Resolved"
      ? "Resolved"
      : statusRaw === "Reviewed"
        ? "Reviewed"
        : "Pending"
  const alertKinds = Array.isArray(r.alertKinds)
    ? r.alertKinds.filter(
        (k): k is FeedbackAlertKind =>
          k === "submitter_reviewed" ||
          k === "submitter_resolved" ||
          k === "admin_new" ||
          k === "admin_updated",
      )
    : undefined
  return {
    id,
    userId: String(r.userId ?? "").trim(),
    username: String(r.username ?? "").trim(),
    userEmail: String(r.userEmail ?? "").trim(),
    pageKey: String(r.pageKey ?? "").trim(),
    pageLabel: String(r.pageLabel ?? "").trim(),
    subPageKey: String(r.subPageKey ?? "").trim(),
    subPageLabel: String(r.subPageLabel ?? "").trim(),
    description: String(r.description ?? ""),
    status,
    adminResponse:
      typeof r.adminResponse === "string" && r.adminResponse.trim()
        ? r.adminResponse
        : null,
    createdAt: String(r.createdAt ?? ""),
    reviewedAt:
      typeof r.reviewedAt === "string" && r.reviewedAt.trim()
        ? r.reviewedAt
        : null,
    reviewedByUserId:
      typeof r.reviewedByUserId === "string" && r.reviewedByUserId.trim()
        ? r.reviewedByUserId
        : null,
    reviewedByName:
      typeof r.reviewedByName === "string" && r.reviewedByName.trim()
        ? r.reviewedByName
        : null,
    resolvedAt:
      typeof r.resolvedAt === "string" && r.resolvedAt.trim()
        ? r.resolvedAt
        : null,
    viewerIsSubmitter:
      typeof r.viewerIsSubmitter === "boolean"
        ? r.viewerIsSubmitter
        : undefined,
    viewerIsReviewer:
      typeof r.viewerIsReviewer === "boolean" ? r.viewerIsReviewer : undefined,
    alertKinds,
  }
}

function asPages(raw: unknown): FeedbackPageOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const r = item as Record<string, unknown>
      const pageKey = String(r.pageKey ?? "").trim()
      const pageLabel = String(r.pageLabel ?? "").trim()
      if (!pageKey || !pageLabel) return null
      const subPages = Array.isArray(r.subPages)
        ? r.subPages
            .map((s) => {
              if (!s || typeof s !== "object") return null
              const rec = s as Record<string, unknown>
              const key = String(rec.key ?? "").trim()
              const label = String(rec.label ?? "").trim()
              if (!key || !label) return null
              return { key, label }
            })
            .filter((s): s is { key: string; label: string } => s != null)
        : []
      return {
        pageKey,
        pageLabel,
        sortOrder: String(r.sortOrder ?? "100"),
        subPages,
      }
    })
    .filter((p): p is FeedbackPageOption => p != null)
}

export async function fetchFeedbackCatalog(): Promise<
  { ok: true; pages: FeedbackPageOption[] } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback/catalog`, {
      headers: authHeaders(),
      credentials: "include",
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not load pages."),
      }
    }
    const pages = asPages(
      data && typeof data === "object"
        ? (data as { pages?: unknown }).pages
        : null,
    )
    return { ok: true, pages }
  } catch {
    return { ok: false, message: "Could not load pages." }
  }
}

export async function saveFeedbackCatalog(
  pages: FeedbackPageOption[],
): Promise<
  { ok: true; pages: FeedbackPageOption[] } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback/catalog`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pages }),
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not save page options."),
      }
    }
    const next = asPages(
      data && typeof data === "object"
        ? (data as { pages?: unknown }).pages
        : null,
    )
    return { ok: true, pages: next }
  } catch {
    return { ok: false, message: "Could not save page options." }
  }
}

export async function fetchPendingFeedbackCount(): Promise<number> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback/pending-count`, {
      headers: authHeaders(),
      credentials: "include",
    })
    if (!res.ok) return 0
    const data: unknown = await res.json().catch(() => null)
    if (!data || typeof data !== "object") return 0
    const n = Number((data as { pendingCount?: unknown }).pendingCount)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
  } catch {
    return 0
  }
}

export async function submitFeedback(input: {
  pageKey: string
  subPageKey: string
  subPageOther?: string
  description: string
}): Promise<
  { ok: true; feedback: FeedbackItem } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not submit feedback."),
      }
    }
    const feedback = asFeedback(
      data && typeof data === "object"
        ? (data as { feedback?: unknown }).feedback
        : null,
    )
    if (!feedback) {
      return { ok: false, message: "Could not submit feedback." }
    }
    return { ok: true, feedback }
  } catch {
    return { ok: false, message: "Could not submit feedback." }
  }
}

export async function fetchFeedbackList(
  status?: FeedbackStatus,
): Promise<
  { ok: true; items: FeedbackItem[] } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  const qs = status ? `?status=${encodeURIComponent(status)}` : ""
  try {
    const res = await fetch(`${base}/feedback${qs}`, {
      headers: authHeaders(),
      credentials: "include",
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not load feedback."),
      }
    }
    const raw =
      data && typeof data === "object"
        ? (data as { items?: unknown }).items
        : null
    const items = Array.isArray(raw)
      ? raw.map(asFeedback).filter((x): x is FeedbackItem => x != null)
      : []
    return { ok: true, items }
  } catch {
    return { ok: false, message: "Could not load feedback." }
  }
}

export async function fetchMyFeedbackAlerts(): Promise<FeedbackItem[]> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback/my-alerts`, {
      headers: authHeaders(),
      credentials: "include",
    })
    if (!res.ok) return []
    const data: unknown = await res.json().catch(() => null)
    const raw =
      data && typeof data === "object"
        ? (data as { items?: unknown }).items
        : null
    return Array.isArray(raw)
      ? raw.map(asFeedback).filter((x): x is FeedbackItem => x != null)
      : []
  } catch {
    return []
  }
}

export async function fetchMyFeedback(): Promise<
  { ok: true; items: FeedbackItem[] } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(`${base}/feedback/mine`, {
      headers: authHeaders(),
      credentials: "include",
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not load feedback."),
      }
    }
    const raw =
      data && typeof data === "object"
        ? (data as { items?: unknown }).items
        : null
    const items = Array.isArray(raw)
      ? raw.map(asFeedback).filter((x): x is FeedbackItem => x != null)
      : []
    return { ok: true, items }
  } catch {
    return { ok: false, message: "Could not load feedback." }
  }
}

export async function fetchFeedbackItem(
  feedbackId: string,
): Promise<
  { ok: true; feedback: FeedbackItem } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(
      `${base}/feedback/item/${encodeURIComponent(feedbackId)}`,
      {
        headers: authHeaders(),
        credentials: "include",
      },
    )
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not load feedback."),
      }
    }
    const feedback = asFeedback(
      data && typeof data === "object"
        ? (data as { feedback?: unknown }).feedback
        : null,
    )
    if (!feedback) {
      return { ok: false, message: "Could not load feedback." }
    }
    return { ok: true, feedback }
  } catch {
    return { ok: false, message: "Could not load feedback." }
  }
}

export async function updateFeedback(
  feedbackId: string,
  input: {
    pageKey: string
    subPageKey: string
    subPageOther?: string
    description: string
  },
): Promise<
  { ok: true; feedback: FeedbackItem } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(
      `${base}/feedback/${encodeURIComponent(feedbackId)}`,
      {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      },
    )
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not update feedback."),
      }
    }
    const feedback = asFeedback(
      data && typeof data === "object"
        ? (data as { feedback?: unknown }).feedback
        : null,
    )
    if (!feedback) {
      return { ok: false, message: "Could not update feedback." }
    }
    return { ok: true, feedback }
  } catch {
    return { ok: false, message: "Could not update feedback." }
  }
}

export async function reviewFeedback(
  feedbackId: string,
  input: { action: FeedbackReviewAction; adminResponse: string },
): Promise<
  { ok: true; feedback: FeedbackItem } | { ok: false; message: string }
> {
  const base = getApiV1Base()
  try {
    const res = await fetch(
      `${base}/feedback/${encodeURIComponent(feedbackId)}/review`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: input.action,
          adminResponse: input.adminResponse,
        }),
      },
    )
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        message: messageFromBody(data, "Could not review feedback."),
      }
    }
    const feedback = asFeedback(
      data && typeof data === "object"
        ? (data as { feedback?: unknown }).feedback
        : null,
    )
    if (!feedback) {
      return { ok: false, message: "Could not review feedback." }
    }
    return { ok: true, feedback }
  } catch {
    return { ok: false, message: "Could not review feedback." }
  }
}
