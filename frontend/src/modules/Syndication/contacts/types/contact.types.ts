export type ContactStatus = "active" | "suspended"

export interface ContactRow {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  note: string
  tags: string[]
  lists: string[]
  owners: string[]
  /** `active` (default) or `suspended` */
  status?: ContactStatus
  /** Text from the most recent edit (required when saving edits) */
  lastEditReason?: string
  /** Resolved display name for the user who created the row (from API) */
  createdByDisplayName?: string
  /** ISO timestamp when the contact was created (from API) */
  createdAt?: string
  /** Rows in deal_investment with contact_id = this contact id (viewer deal scope) */
  dealCount?: number
}
