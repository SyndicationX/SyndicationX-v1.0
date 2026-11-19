import type {
  BankAccountSetupStatus,
  StripeBankConnection,
} from "@/modules/Investing/api/stripeInvestorPaymentsApi"

const TITLE =
  "Whether bank account details are on file. This does not mean the account has been verified or that ACH processing is enabled."

export function BankAccountSetupBadge({
  status,
  onClick,
  ariaLabel,
}: {
  status: BankAccountSetupStatus | undefined
  /** Opens bank account setup details. Omit for viewers without access. */
  onClick?: () => void
  ariaLabel?: string
}) {
  const setUp = status === "set_up"
  const className = `deal_dist_ach_badge deal_dist_ach_badge--${setUp ? "success" : "neutral"}`
  const label = setUp ? "Set Up" : "Not Set Up"
  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} deal_dist_bank_setup_badge_btn`}
        title={`${TITLE} Click to view bank account setup details.`}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <span className={className} title={TITLE}>
      {label}
    </span>
  )
}

export function StripeConnectionBadge({
  connection,
}: {
  connection: StripeBankConnection | undefined
}) {
  const value = connection ?? "not_connected"
  const connected = value === "connected"
  const pending = value === "pending"
  const tone = connected ? "success" : "danger"
  const label = connected
    ? "Stripe connected"
    : pending
      ? "Stripe pending"
      : "Not on Stripe"
  return (
    <span
      className={`deal_dist_ach_badge deal_dist_ach_badge--${tone}`}
      title={
        connected
          ? "This investor profile is connected to Stripe and can receive ACH."
          : pending
            ? "Stripe setup was started but payouts are not active yet."
            : "Bank details may be saved, but this profile is not connected to Stripe."
      }
    >
      {label}
    </span>
  )
}

export type BankAccountSetupView = {
  status: BankAccountSetupStatus
  stripeConnection: StripeBankConnection
}

export function bankAccountSetupLookup(
  lines: {
    investmentId: string
    status: BankAccountSetupStatus
    stripeConnection?: StripeBankConnection
  }[],
): Map<string, BankAccountSetupView> {
  const map = new Map<string, BankAccountSetupView>()
  for (const line of lines) {
    const id = line.investmentId.trim().toLowerCase()
    if (!id) continue
    map.set(id, {
      status: line.status,
      stripeConnection: line.stripeConnection ?? "not_connected",
    })
  }
  return map
}
