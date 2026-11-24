export const EXTRA_COMPANY_USER_PAYMENT_REQUIRED =
  "EXTRA_COMPANY_USER_PAYMENT_REQUIRED"

export const CONTACT_SALES_REQUIRED = "CONTACT_SALES_REQUIRED"

export const CONTACT_SALES_LABEL = "Contact sales"

/** Self-serve stops at 24 company users. The 25th is custom pricing. */
export const CO_SPONSOR_SELF_SERVE_MAX = 24

function normalizeRosterRole(raw: string | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
}

export function isCoSponsorRole(raw: string | undefined): boolean {
  const s = normalizeRosterRole(raw)
  return s === "co sponsor" || s === "cosponsor"
}

/** Lead, admin, co-sponsor, deal member, and general partner share the cap. */
export function isCompanyUserRosterRole(raw: string | undefined): boolean {
  const s = normalizeRosterRole(raw)
  return (
    s === "lead sponsor" ||
    s === "admin sponsor" ||
    isCoSponsorRole(raw) ||
    s === "deal member" ||
    s === "general partner" ||
    s === "general partners" ||
    s === "team member" ||
    s === "team members"
  )
}

export function contactSalesMessageFromBody(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const code = String((data as Record<string, unknown>).code ?? "").trim()
  if (code !== CONTACT_SALES_REQUIRED) return null
  return CONTACT_SALES_LABEL
}

export type ExtraCompanyUserPaymentRequired = {
  code: typeof EXTRA_COMPANY_USER_PAYMENT_REQUIRED
  message: string
  dealId: string
  dealName: string
  planId?: string
  includedCompanyUsers: number
  currentCompanyUsers: number
  extraUsersToPay: number
  extraUserFeeCents: number
  amountDueCents: number
  comment?: string
}

export class ExtraCompanyUserPaymentRequiredError extends Error {
  readonly code = EXTRA_COMPANY_USER_PAYMENT_REQUIRED
  readonly statusCode = 402
  readonly payload: ExtraCompanyUserPaymentRequired

  constructor(payload: ExtraCompanyUserPaymentRequired, message?: string) {
    super(message || payload.message)
    this.name = "ExtraCompanyUserPaymentRequiredError"
    this.payload = payload
  }
}

export function isExtraCompanyUserPaymentRequiredError(
  err: unknown,
): err is ExtraCompanyUserPaymentRequiredError {
  return err instanceof ExtraCompanyUserPaymentRequiredError
}

export function parseExtraCompanyUserPaymentBody(
  data: unknown,
  fallbackDealId?: string,
): ExtraCompanyUserPaymentRequired | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const rec = data as Record<string, unknown>
  const code = String(rec.code ?? "").trim()
  if (code && code !== EXTRA_COMPANY_USER_PAYMENT_REQUIRED) return null
  const dealId = String(rec.dealId ?? rec.deal_id ?? fallbackDealId ?? "").trim()
  const extraUsersToPay = Number(rec.extraUsersToPay ?? rec.extra_users_to_pay ?? 0)
  const amountDueCents = Number(rec.amountDueCents ?? rec.amount_due_cents ?? 0)
  if (!dealId) return null
  if (code !== EXTRA_COMPANY_USER_PAYMENT_REQUIRED && extraUsersToPay <= 0) {
    return null
  }
  const message =
    typeof rec.message === "string" && rec.message.trim()
      ? rec.message.trim()
      : "Pay $10 for each extra company user beyond this deal’s plan."
  return {
    code: EXTRA_COMPANY_USER_PAYMENT_REQUIRED,
    message,
    dealId,
    dealName: String(rec.dealName ?? rec.deal_name ?? "").trim(),
    planId:
      rec.planId != null || rec.plan_id != null
        ? String(rec.planId ?? rec.plan_id)
        : undefined,
    includedCompanyUsers: Number(rec.includedCompanyUsers ?? rec.included_company_users ?? 0) || 0,
    currentCompanyUsers: Number(rec.currentCompanyUsers ?? rec.current_company_users ?? 0) || 0,
    extraUsersToPay: Number.isFinite(extraUsersToPay) ? extraUsersToPay : 1,
    extraUserFeeCents: Number(rec.extraUserFeeCents ?? rec.extra_user_fee_cents ?? 1000) || 1000,
    amountDueCents: Number.isFinite(amountDueCents) ? amountDueCents : 1000,
    comment:
      typeof rec.comment === "string" && rec.comment.trim()
        ? rec.comment.trim()
        : undefined,
  }
}
