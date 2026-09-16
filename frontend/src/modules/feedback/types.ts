export type FeedbackStatus = "Pending" | "Reviewed" | "Resolved"

export type FeedbackReviewAction = "reviewed" | "resolved"

export type FeedbackAlertKind =
  | "submitter_reviewed"
  | "submitter_resolved"
  | "admin_new"
  | "admin_updated"

export type FeedbackSubPageOption = {
  key: string
  label: string
}

export type FeedbackPageOption = {
  pageKey: string
  pageLabel: string
  sortOrder: string
  subPages: FeedbackSubPageOption[]
}

export type FeedbackItem = {
  id: string
  userId: string
  username: string
  userEmail: string
  pageKey: string
  pageLabel: string
  subPageKey: string
  subPageLabel: string
  description: string
  status: FeedbackStatus
  adminResponse: string | null
  createdAt: string
  reviewedAt: string | null
  reviewedByUserId: string | null
  reviewedByName: string | null
  resolvedAt: string | null
  viewerIsSubmitter?: boolean
  viewerIsReviewer?: boolean
  alertKinds?: FeedbackAlertKind[]
}
