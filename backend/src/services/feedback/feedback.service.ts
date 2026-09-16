import { and, asc, count, desc, eq, or } from "drizzle-orm";
import { db } from "../../database/db.js";
import { DEFAULT_FEEDBACK_PAGE_CATALOG } from "../../constants/feedbackPages.js";
import {
  FEEDBACK_STATUS_PENDING,
  FEEDBACK_STATUS_REVIEWED,
  FEEDBACK_STATUS_RESOLVED,
  FEEDBACK_SUB_PAGE_OTHER_KEY,
  FEEDBACK_SUB_PAGE_OTHER_LABEL,
  feedbackPageCatalog,
  userFeedback,
  type FeedbackReviewAction,
  type FeedbackStatus,
  type FeedbackSubPageOption,
  type UserFeedbackRow,
} from "../../schema/feedback.schema.js";
import { users } from "../../schema/auth.schema/signin.js";

export type FeedbackPageCatalogItem = {
  pageKey: string;
  pageLabel: string;
  sortOrder: string;
  subPages: FeedbackSubPageOption[];
};

export type FeedbackPublicRow = {
  id: string;
  userId: string;
  username: string;
  userEmail: string;
  pageKey: string;
  pageLabel: string;
  subPageKey: string;
  subPageLabel: string;
  description: string;
  status: FeedbackStatus;
  adminResponse: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  resolvedAt: string | null;
};

function normalizeSubPages(raw: unknown): FeedbackSubPageOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedbackSubPageOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? "").trim();
    if (!label) continue;
    const key =
      String(rec.key ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
  }
  return out;
}

function normalizeStatus(raw: string | null | undefined): FeedbackStatus {
  if (raw === FEEDBACK_STATUS_REVIEWED) return FEEDBACK_STATUS_REVIEWED;
  if (raw === FEEDBACK_STATUS_RESOLVED) return FEEDBACK_STATUS_RESOLVED;
  return FEEDBACK_STATUS_PENDING;
}

function toPublic(row: UserFeedbackRow): FeedbackPublicRow {
  const response = String(row.adminResponse ?? "").trim();
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    userEmail: row.userEmail,
    pageKey: row.pageKey,
    pageLabel: row.pageLabel,
    subPageKey: row.subPageKey,
    subPageLabel: row.subPageLabel,
    description: row.description,
    status: normalizeStatus(row.status),
    adminResponse: response || null,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedByUserId: row.reviewedByUserId,
    reviewedByName: row.reviewedByName,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export function displayNameFromUser(user: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const firstLast = [user.firstName, user.lastName]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const username = String(user.username ?? "").trim();
  return firstLast || username || String(user.email ?? "").trim() || "User";
}

export async function ensureFeedbackPageCatalog(): Promise<
  FeedbackPageCatalogItem[]
> {
  const existing = await db
    .select()
    .from(feedbackPageCatalog)
    .orderBy(asc(feedbackPageCatalog.sortOrder), asc(feedbackPageCatalog.pageLabel));

  if (existing.length === 0) {
    await db.insert(feedbackPageCatalog).values(
      DEFAULT_FEEDBACK_PAGE_CATALOG.map((page) => ({
        pageKey: page.pageKey,
        pageLabel: page.pageLabel,
        sortOrder: page.sortOrder,
        subPages: page.subPages,
      })),
    );
    return DEFAULT_FEEDBACK_PAGE_CATALOG.map((page) => ({ ...page }));
  }

  return existing.map((row) => ({
    pageKey: row.pageKey,
    pageLabel: row.pageLabel,
    sortOrder: row.sortOrder,
    subPages: normalizeSubPages(row.subPages),
  }));
}

export async function replaceFeedbackPageCatalog(
  pages: FeedbackPageCatalogItem[],
): Promise<FeedbackPageCatalogItem[]> {
  const cleaned: FeedbackPageCatalogItem[] = [];
  const seen = new Set<string>();
  for (const [index, page] of pages.entries()) {
    const pageLabel = String(page.pageLabel ?? "").trim();
    if (!pageLabel) continue;
    const pageKey =
      String(page.pageKey ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") ||
      pageLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    if (!pageKey || seen.has(pageKey)) continue;
    seen.add(pageKey);
    cleaned.push({
      pageKey,
      pageLabel,
      sortOrder: String(page.sortOrder ?? (index + 1) * 10),
      subPages: normalizeSubPages(page.subPages),
    });
  }
  if (cleaned.length === 0) {
    throw new Error("At least one page is required");
  }

  await db.delete(feedbackPageCatalog);
  await db.insert(feedbackPageCatalog).values(
    cleaned.map((page) => ({
      pageKey: page.pageKey,
      pageLabel: page.pageLabel,
      sortOrder: page.sortOrder,
      subPages: page.subPages,
    })),
  );
  return cleaned;
}

export async function resolveCatalogPage(
  pageKey: string,
  subPageKey: string,
  subPageOtherLabel?: string,
): Promise<{
  pageKey: string;
  pageLabel: string;
  subPageKey: string;
  subPageLabel: string;
} | null> {
  const catalog = await ensureFeedbackPageCatalog();
  const page = catalog.find((p) => p.pageKey === pageKey);
  if (!page) return null;
  if (subPageKey === FEEDBACK_SUB_PAGE_OTHER_KEY) {
    const custom = String(subPageOtherLabel ?? "").trim();
    if (!custom) return null;
    if (custom.length > 200) return null;
    return {
      pageKey: page.pageKey,
      pageLabel: page.pageLabel,
      subPageKey: FEEDBACK_SUB_PAGE_OTHER_KEY,
      subPageLabel: `${FEEDBACK_SUB_PAGE_OTHER_LABEL} — ${custom}`,
    };
  }
  const tab = page.subPages.find((s) => s.key === subPageKey);
  if (!tab) return null;
  return {
    pageKey: page.pageKey,
    pageLabel: page.pageLabel,
    subPageKey: tab.key,
    subPageLabel: tab.label,
  };
}

export async function createUserFeedback(input: {
  userId: string;
  username: string;
  userEmail: string;
  pageKey: string;
  subPageKey: string;
  subPageOther?: string;
  description: string;
}): Promise<FeedbackPublicRow> {
  const description = String(input.description ?? "").trim();
  if (description.length < 3) {
    throw new Error("Description is required");
  }
  if (description.length > 8000) {
    throw new Error("Description is too long");
  }

  if (
    input.subPageKey === FEEDBACK_SUB_PAGE_OTHER_KEY &&
    !String(input.subPageOther ?? "").trim()
  ) {
    throw new Error("Enter the sub page / tab name");
  }

  const resolved = await resolveCatalogPage(
    input.pageKey,
    input.subPageKey,
    input.subPageOther,
  );
  if (!resolved) {
    throw new Error("Select a valid page and sub page");
  }

  const [row] = await db
    .insert(userFeedback)
    .values({
      userId: input.userId,
      username: input.username,
      userEmail: input.userEmail,
      pageKey: resolved.pageKey,
      pageLabel: resolved.pageLabel,
      subPageKey: resolved.subPageKey,
      subPageLabel: resolved.subPageLabel,
      description,
      status: FEEDBACK_STATUS_PENDING,
    })
    .returning();

  if (!row) throw new Error("Could not save feedback");
  return toPublic(row);
}

export async function countPendingFeedback(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(userFeedback)
    .where(eq(userFeedback.status, FEEDBACK_STATUS_PENDING));
  return Number(row?.n ?? 0);
}

export async function countPendingFeedbackForUser(
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(userFeedback)
    .where(
      and(
        eq(userFeedback.userId, userId),
        eq(userFeedback.status, FEEDBACK_STATUS_PENDING),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function updateUserFeedback(input: {
  feedbackId: string;
  userId: string;
  pageKey: string;
  subPageKey: string;
  subPageOther?: string;
  description: string;
}): Promise<FeedbackPublicRow> {
  const [existing] = await db
    .select()
    .from(userFeedback)
    .where(eq(userFeedback.id, input.feedbackId))
    .limit(1);
  if (!existing) {
    throw new Error("Feedback not found");
  }
  if (existing.userId !== input.userId) {
    throw new Error("Not allowed");
  }
  if (normalizeStatus(existing.status) !== FEEDBACK_STATUS_PENDING) {
    throw new Error("This feedback can no longer be edited");
  }

  const description = String(input.description ?? "").trim();
  if (description.length < 3) {
    throw new Error("Description is required");
  }
  if (description.length > 8000) {
    throw new Error("Description is too long");
  }
  if (
    input.subPageKey === FEEDBACK_SUB_PAGE_OTHER_KEY &&
    !String(input.subPageOther ?? "").trim()
  ) {
    throw new Error("Enter the sub page / tab name");
  }

  const resolved = await resolveCatalogPage(
    input.pageKey,
    input.subPageKey,
    input.subPageOther,
  );
  if (!resolved) {
    throw new Error("Select a valid page and sub page");
  }

  const [updated] = await db
    .update(userFeedback)
    .set({
      pageKey: resolved.pageKey,
      pageLabel: resolved.pageLabel,
      subPageKey: resolved.subPageKey,
      subPageLabel: resolved.subPageLabel,
      description,
    })
    .where(eq(userFeedback.id, input.feedbackId))
    .returning();

  if (!updated) throw new Error("Could not update feedback");
  return toPublic(updated);
}

export async function listFeedbackForAdmin(
  status?: FeedbackStatus,
): Promise<FeedbackPublicRow[]> {
  const rows = status
    ? await db
        .select()
        .from(userFeedback)
        .where(eq(userFeedback.status, status))
        .orderBy(desc(userFeedback.createdAt))
    : await db
        .select()
        .from(userFeedback)
        .orderBy(desc(userFeedback.createdAt));
  return rows.map(toPublic);
}

export type FeedbackAlertKind =
  | "submitter_reviewed"
  | "submitter_resolved"
  | "admin_new"
  | "admin_updated";

export type FeedbackAlertRow = FeedbackPublicRow & {
  viewerIsSubmitter: boolean;
  viewerIsReviewer: boolean;
  alertKinds: FeedbackAlertKind[];
};

export async function listMyFeedback(
  userId: string,
): Promise<FeedbackPublicRow[]> {
  const rows = await db
    .select()
    .from(userFeedback)
    .where(eq(userFeedback.userId, userId))
    .orderBy(desc(userFeedback.createdAt));
  return rows.map(toPublic);
}

export async function getFeedbackForViewer(
  feedbackId: string,
  viewerId: string,
  isPlatformAdmin: boolean,
): Promise<FeedbackPublicRow | null> {
  const [row] = await db
    .select()
    .from(userFeedback)
    .where(eq(userFeedback.id, feedbackId))
    .limit(1);
  if (!row) return null;
  if (!isPlatformAdmin && row.userId !== viewerId) return null;
  return toPublic(row);
}

export async function listFeedbackAlertsForUser(input: {
  userId: string;
  isPlatformAdmin: boolean;
}): Promise<FeedbackAlertRow[]> {
  const rows = input.isPlatformAdmin
    ? await db
        .select()
        .from(userFeedback)
        .orderBy(desc(userFeedback.createdAt))
    : await db
        .select()
        .from(userFeedback)
        .where(
          and(
            eq(userFeedback.userId, input.userId),
            or(
              eq(userFeedback.status, FEEDBACK_STATUS_REVIEWED),
              eq(userFeedback.status, FEEDBACK_STATUS_RESOLVED),
            ),
          ),
        )
        .orderBy(desc(userFeedback.reviewedAt), desc(userFeedback.createdAt));

  return rows
    .map((row) => {
      const status = normalizeStatus(row.status);
      const viewerIsSubmitter = row.userId === input.userId;
      const viewerIsReviewer = row.reviewedByUserId === input.userId;
      const alertKinds: FeedbackAlertKind[] = [];
      if (viewerIsSubmitter && status === FEEDBACK_STATUS_REVIEWED) {
        alertKinds.push("submitter_reviewed");
      }
      if (viewerIsSubmitter && status === FEEDBACK_STATUS_RESOLVED) {
        alertKinds.push("submitter_resolved");
      }
      if (
        input.isPlatformAdmin &&
        status === FEEDBACK_STATUS_PENDING &&
        !viewerIsSubmitter
      ) {
        alertKinds.push("admin_new");
      }
      if (
        input.isPlatformAdmin &&
        (status === FEEDBACK_STATUS_REVIEWED ||
          status === FEEDBACK_STATUS_RESOLVED) &&
        !viewerIsReviewer
      ) {
        alertKinds.push("admin_updated");
      }
      return {
        ...toPublic(row),
        viewerIsSubmitter,
        viewerIsReviewer,
        alertKinds,
      };
    })
    .filter((row) => row.alertKinds.length > 0);
}

export async function reviewUserFeedback(input: {
  feedbackId: string;
  reviewerUserId: string;
  reviewerName: string;
  action: FeedbackReviewAction;
  adminResponse?: string;
}): Promise<FeedbackPublicRow> {
  const [existing] = await db
    .select()
    .from(userFeedback)
    .where(eq(userFeedback.id, input.feedbackId))
    .limit(1);
  if (!existing) {
    throw new Error("Feedback not found");
  }

  const notes = String(input.adminResponse ?? "").trim();
  if (notes.length > 8000) {
    throw new Error("Review comments are too long");
  }
  if (input.action === "resolved" && notes.length < 3) {
    throw new Error("Enter review comments before marking as resolved");
  }

  const current = normalizeStatus(existing.status);
  if (current === FEEDBACK_STATUS_RESOLVED) {
    return toPublic(existing);
  }

  const now = new Date();
  const nextStatus =
    input.action === "resolved"
      ? FEEDBACK_STATUS_RESOLVED
      : FEEDBACK_STATUS_REVIEWED;

  const [updated] = await db
    .update(userFeedback)
    .set({
      status: nextStatus,
      adminResponse: notes || existing.adminResponse || null,
      reviewedAt: existing.reviewedAt ?? now,
      reviewedByUserId: input.reviewerUserId,
      reviewedByName: input.reviewerName,
      resolvedAt:
        nextStatus === FEEDBACK_STATUS_RESOLVED
          ? (existing.resolvedAt ?? now)
          : existing.resolvedAt,
    })
    .where(eq(userFeedback.id, input.feedbackId))
    .returning();

  if (!updated) throw new Error("Could not review feedback");
  return toPublic(updated);
}

export async function getUserById(userId: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
