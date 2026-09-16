import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth.schema/signin.js";

export const FEEDBACK_STATUS_PENDING = "Pending";
export const FEEDBACK_STATUS_REVIEWED = "Reviewed";
export const FEEDBACK_STATUS_RESOLVED = "Resolved";
export const FEEDBACK_SUB_PAGE_OTHER_KEY = "other";
export const FEEDBACK_SUB_PAGE_OTHER_LABEL = "Other";

export type FeedbackStatus =
  | typeof FEEDBACK_STATUS_PENDING
  | typeof FEEDBACK_STATUS_REVIEWED
  | typeof FEEDBACK_STATUS_RESOLVED;

export type FeedbackReviewAction = "reviewed" | "resolved";

export type FeedbackSubPageOption = {
  key: string;
  label: string;
};

export const userFeedback = pgTable(
  "user_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    username: varchar("username", { length: 200 }).notNull(),
    userEmail: varchar("user_email", { length: 255 }).notNull(),
    pageKey: varchar("page_key", { length: 120 }).notNull(),
    pageLabel: varchar("page_label", { length: 200 }).notNull(),
    subPageKey: varchar("sub_page_key", { length: 120 }).notNull().default(""),
    subPageLabel: varchar("sub_page_label", { length: 200 }).notNull().default(""),
    description: text("description").notNull(),
    status: varchar("status", { length: 32 })
      .notNull()
      .default(FEEDBACK_STATUS_PENDING),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    adminResponse: text("admin_response"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: varchar("reviewed_by_name", { length: 200 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("user_feedback_status_idx").on(t.status),
    userIdx: index("user_feedback_user_id_idx").on(t.userId),
    createdIdx: index("user_feedback_created_at_idx").on(t.createdAt),
  }),
);

/** Editable Page → Sub Page / Tab catalog used by the feedback form. */
export const feedbackPageCatalog = pgTable("feedback_page_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageKey: varchar("page_key", { length: 120 }).notNull().unique(),
  pageLabel: varchar("page_label", { length: 200 }).notNull(),
  sortOrder: varchar("sort_order", { length: 16 }).notNull().default("100"),
  subPages: jsonb("sub_pages").$type<FeedbackSubPageOption[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type UserFeedbackRow = typeof userFeedback.$inferSelect;
export type UserFeedbackInsert = typeof userFeedback.$inferInsert;
export type FeedbackPageCatalogRow = typeof feedbackPageCatalog.$inferSelect;
