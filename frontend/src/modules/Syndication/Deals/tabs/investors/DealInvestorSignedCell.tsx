import { CircleCheck, Clock3, Eye } from "lucide-react"
import type { DealInvestorRow } from "../../types/deal-investors.types"
import {
  investorRowShowsEsignStatusLink,
  investorSignedColumnDisplay,
  resolveInvestorRowEsignStatus,
} from "../../utils/investorEsignStatus"

export interface DealInvestorSignedCellProps {
  row: DealInvestorRow
  onOpenEsignStatus?: (row: DealInvestorRow) => void
}

type SignedTone = "done" | "viewed" | "sent"

function signedTone(display: string): SignedTone | null {
  const value = display.trim().toLowerCase()
  if (!value || value === "—") return null
  if (value === "sent" || value === "pending") return "sent"
  if (value === "viewed") return "viewed"
  return "done"
}

function SignedStatusIcon({ tone }: { tone: SignedTone }) {
  const props = { size: 14, strokeWidth: 2, "aria-hidden": true as const }
  if (tone === "sent") return <Clock3 {...props} />
  if (tone === "viewed") return <Eye {...props} />
  return <CircleCheck {...props} />
}

export function DealInvestorSignedCell({
  row,
  onOpenEsignStatus,
}: DealInvestorSignedCellProps) {
  const display = investorSignedColumnDisplay(row)
  const hasEsignWorkflow =
    Boolean(resolveInvestorRowEsignStatus(row)?.sentAt?.trim()) ||
    investorRowShowsEsignStatusLink(row)
  const clickable = hasEsignWorkflow && Boolean(onOpenEsignStatus)

  if (import.meta.env.DEV && display === "—" && row.docSignedDateIso) {
    console.debug("[DealInvestorSignedCell] row has docSignedDateIso but column is —", {
      id: row.id,
      docSignedDateIso: row.docSignedDateIso,
      signedDate: row.signedDate,
      esignStatus: row.esignStatus,
      esignStatusBundleJson: row.esignStatusBundleJson?.slice?.(0, 80),
    })
  }

  const tone = signedTone(display)
  if (!tone) {
    return <span className="deal_inv_signed_empty">—</span>
  }

  const className = `deal_inv_signed_pill deal_inv_signed_pill--${tone}`
  const label = (
    <>
      <span className="deal_inv_signed_pill_icon">
        <SignedStatusIcon tone={tone} />
      </span>
      <span className="deal_inv_signed_pill_label">{display}</span>
    </>
  )

  if (!clickable) {
    return (
      <span className={className} title={display}>
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={className}
      title={`eSign status: ${display}. Click for details.`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        const targetRow = row
        queueMicrotask(() => onOpenEsignStatus?.(targetRow))
      }}
    >
      {label}
    </button>
  )
}
