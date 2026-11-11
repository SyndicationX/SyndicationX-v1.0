import type { BankAccountSetupStatus } from "@/modules/Investing/api/stripeInvestorPaymentsApi"

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

export function bankAccountSetupLookup(
  lines: { investmentId: string; status: BankAccountSetupStatus }[],
): Map<string, BankAccountSetupStatus> {
  const map = new Map<string, BankAccountSetupStatus>()
  for (const line of lines) {
    const id = line.investmentId.trim().toLowerCase()
    if (id) map.set(id, line.status)
  }
  return map
}
