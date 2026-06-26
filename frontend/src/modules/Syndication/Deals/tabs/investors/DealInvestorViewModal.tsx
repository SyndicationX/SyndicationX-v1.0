import {
  Activity,
  BadgeCheck,
  Briefcase,
  Calendar,
  DollarSign,
  IdCard,
  Mail,
  Pencil,
  Shield,
  Tag,
  User,
  UserRound,
  X,
} from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { CardCompactAmount } from "../../../../../common/components/card-compact-amount/CardCompactAmount"
import { ViewReadonlyField } from "../../../../../common/components/ViewReadonlyField"
import { formatDateDdMmmYyyy } from "../../../../../common/utils/formatDateDisplay"
import { investorRoleLabel } from "../../constants/investor-profile"
import { investorSignedColumnDisplay } from "../../utils/investorEsignStatus"
import type { DealInvestorClass } from "../../types/deal-investor-class.types"
import type { DealInvestorRow } from "../../types/deal-investors.types"
import "../../../usermanagement/user_management.css"
import "../../deals-list.css"

interface DealInvestorViewModalProps {
  row: DealInvestorRow | null
  onClose: () => void
  investorClasses: DealInvestorClass[]
  /** Comma-separated class names for the deal when the row has no assigned class */
  dealAllClassNamesLine: string
  onEdit: (row: DealInvestorRow) => void
}

function displayOrDash(v: string | null | undefined): string {
  const t = String(v ?? "").trim()
  if (!t || t === "—") return "—"
  return t
}

function resolveInvestorClassDisplay(
  row: DealInvestorRow,
  classes: DealInvestorClass[],
  dealLine: string,
): string {
  const raw = (row.investorClass ?? "").trim()
  if (raw) {
    const byId = classes.find((c) => c.id === raw)
    if (byId) {
      const name = byId.name.trim()
      return name || byId.id
    }
    return raw
  }
  const fallback = dealLine.trim()
  return fallback || "—"
}

export function DealInvestorViewModal({
  row,
  onClose,
  investorClasses,
  dealAllClassNamesLine,
  onEdit,
}: DealInvestorViewModalProps) {
  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [row, onClose])

  if (row == null) return null

  const investorRow = row

  const invClass = resolveInvestorClassDisplay(
    investorRow,
    investorClasses,
    dealAllClassNamesLine,
  )

  function handleEdit() {
    onEdit(investorRow)
    onClose()
  }

  return createPortal(
    <div
      className="um_modal_overlay deals_deal_view_modal_overlay"
      role="presentation"
    >
      <div
        className="um_modal um_modal_view deals_deal_view_modal deal_inv_investor_view_modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deal-inv-investor-view-title"
      >
        <div className="um_modal_head">
          <h2 id="deal-inv-investor-view-title" className="um_modal_title">
            Investor details
          </h2>
          <button
            type="button"
            className="um_modal_close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="deals_deal_view_modal_body">
          <div className="um_view_grid">
            <ViewReadonlyField
              Icon={UserRound}
              label="Member name"
              value={displayOrDash(investorRow.displayName)}
            />
            <ViewReadonlyField
              Icon={IdCard}
              label="Profile"
              value={displayOrDash(investorRow.entitySubtitle)}
            />
            <ViewReadonlyField
              Icon={User}
              label="Username"
              value={displayOrDash(investorRow.userDisplayName)}
            />
            <ViewReadonlyField
              Icon={Mail}
              label="Email"
              value={displayOrDash(investorRow.userEmail)}
            />
            <ViewReadonlyField
              Icon={Briefcase}
              label="Role"
              value={investorRoleLabel(investorRow.investorRole ?? "")}
            />
            <ViewReadonlyField
              Icon={Tag}
              label="Investor class"
              value={invClass}
            />
            <ViewReadonlyField
              Icon={Activity}
              label="Status"
              value={displayOrDash(investorRow.status)}
            />
            <ViewReadonlyField
              Icon={DollarSign}
              label="Committed"
              value={<CardCompactAmount amount={investorRow.committed} />}
            />
            <ViewReadonlyField
              Icon={Calendar}
              label="Signed"
              value={investorSignedColumnDisplay(investorRow)}
            />
            <ViewReadonlyField
              Icon={Calendar}
              label="Funded"
              value={formatDateDdMmmYyyy(investorRow.fundedDate)}
            />
            <ViewReadonlyField
              Icon={Shield}
              label="Self accredited"
              value={displayOrDash(investorRow.selfAccredited)}
            />
            <ViewReadonlyField
              Icon={BadgeCheck}
              label="Verified accreditation"
              fieldClassName="deals_deal_view_field_full"
              value={displayOrDash(investorRow.verifiedAccLabel)}
            />
          </div>
        </div>

        <div className="um_modal_actions um_modal_actions_view deals_deal_view_modal_actions">
          <button
            type="button"
            className="um_btn_secondary"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden />
            Close
          </button>
          <button
            type="button"
            className="um_btn_primary"
            onClick={handleEdit}
          >
            <Pencil size={16} strokeWidth={2} aria-hidden />
            Edit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
