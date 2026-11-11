import { Landmark, Loader2, X } from "lucide-react"
import { useCallback, useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "@/common/components/Toast"
import {
  ModalCancelButton,
  ModalCloseButton,
  ModalFooterActions,
  ModalFooterTrailing,
  ModalSendButton,
} from "@/common/components/modal/ModalFooterButtons"
import {
  fetchDistributionInvestmentBankAccountDetails,
  requestDistributionInvestmentBankAccountSetup,
  type DistributionBankAccountDetail,
  type DistributionBankAccountDetails,
} from "@/modules/Investing/api/stripeInvestorPaymentsApi"
import { BankAccountSetupBadge } from "./BankAccountSetupBadge"
import "./distribution-details.css"

export type BankAccountSetupDetailsTarget = {
  investmentId: string
  investorName: string
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function connectStatusLabel(account: DistributionBankAccountDetail): string {
  if (account.payoutsEnabled) return "Ready for ACH"
  const status = account.connectStatus?.trim().toLowerCase() ?? ""
  if (!status) return account.detailsPresent ? "Linked" : "Incomplete"
  if (status === "ready") return "Ready for ACH"
  if (status === "not_started" || status === "onboarding") {
    return "Onboarding not finished"
  }
  return titleCase(status)
}

function accountRows(
  account: DistributionBankAccountDetail,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Source",
      value:
        account.source === "stripe_connect"
          ? "Linked via Stripe"
          : "Saved on investor profile",
    },
    { label: "Bank", value: account.bankName ?? "—" },
  ]
  if (account.accountHolderName) {
    rows.push({ label: "Account holder", value: account.accountHolderName })
  }
  rows.push(
    { label: "Account number", value: account.accountNumberMasked ?? "—" },
    { label: "Routing number", value: account.routingNumberMasked ?? "—" },
  )
  if (account.accountType) {
    rows.push({ label: "Account type", value: titleCase(account.accountType) })
  }
  if (account.source === "stripe_connect") {
    rows.push({ label: "Status", value: connectStatusLabel(account) })
  }
  return rows
}

/**
 * Bank account setup details for one distribution line. The server only
 * returns these to the Lead Sponsor, Admin sponsor, or a platform admin.
 */
export function BankAccountSetupDetailsModal({
  dealId,
  distributionId,
  target,
  onClose,
}: {
  dealId: string
  distributionId: string
  target: BankAccountSetupDetailsTarget | null
  onClose: () => void
}) {
  const titleId = useId()
  const [details, setDetails] = useState<DistributionBankAccountDetails | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendingRequest, setSendingRequest] = useState(false)
  const [requestSentTo, setRequestSentTo] = useState<string | null>(null)
  const investmentId = target?.investmentId ?? ""

  const sendSetupRequest = useCallback(async () => {
    if (!investmentId || sendingRequest) return
    setSendingRequest(true)
    try {
      const { sentTo } = await requestDistributionInvestmentBankAccountSetup(
        dealId,
        distributionId,
        investmentId,
      )
      setRequestSentTo(sentTo || "the investor")
      toast.success(
        "Bank setup email sent",
        `${target?.investorName || "The investor"} was asked to add bank details${sentTo ? ` (${sentTo})` : ""}.`,
      )
    } catch (err) {
      toast.error(
        "Could not send email",
        err instanceof Error ? err.message : "Please try again.",
      )
    } finally {
      setSendingRequest(false)
    }
  }, [dealId, distributionId, investmentId, sendingRequest, target?.investorName])

  useEffect(() => {
    if (!investmentId) return
    let cancelled = false
    setDetails(null)
    setError(null)
    setRequestSentTo(null)
    setLoading(true)
    fetchDistributionInvestmentBankAccountDetails(
      dealId,
      distributionId,
      investmentId,
    )
      .then((result) => {
        if (!cancelled) setDetails(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load bank account details.",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dealId, distributionId, investmentId])

  const isOpen = target != null
  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    // Capture phase so Escape closes only this dialog when it sits above another modal.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKey, true)
    }
  }, [isOpen, onClose])

  if (!target || typeof document === "undefined") return null

  const rows: Array<{ label: string; value: string }> = details?.account
    ? [
        { label: "Profile", value: details.investorProfileName ?? "—" },
        ...accountRows(details.account),
      ]
    : []

  return createPortal(
    <div
      className="um_modal_overlay deals_add_inv_modal_overlay portal_modal_z_boost deal_dist_ach_confirm_overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="um_modal um_modal_view deals_add_inv_modal_panel add_contact_panel deals_suspend_all_modal_panel deal_dist_ach_confirm_modal deal_dist_bank_setup_modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="um_modal_head add_contact_modal_head">
          <div className="deal_dist_ach_confirm_head_main">
            <div className="deal_dist_ach_confirm_icon" aria-hidden>
              <Landmark size={18} strokeWidth={1.75} />
            </div>
            <div className="deal_dist_ach_confirm_head_text">
              <p className="deal_dist_ach_confirm_eyebrow">
                Bank account setup
              </p>
              <h3 id={titleId} className="um_modal_title add_contact_modal_title">
                {target.investorName || "Investor"}
              </h3>
            </div>
          </div>
          <button
            type="button"
            className="um_modal_close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="deals_add_inv_modal_scroll deal_dist_ach_confirm_body">
          {loading ? (
            <p className="deal_dist_bank_setup_loading" role="status">
              <Loader2
                size={16}
                className="deals_create_loading_icon"
                aria-hidden
              />
              Loading bank account details…
            </p>
          ) : error ? (
            <p className="deal_dist_ach_confirm_warning" role="alert">
              {error}
            </p>
          ) : details ? (
            <>
              <div className="deal_dist_bank_setup_status">
                <span>Setup status</span>
                <BankAccountSetupBadge status={details.status} />
              </div>
              {rows.length > 0 ? (
                <dl className="deal_dist_ach_confirm_summary">
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className="deal_dist_ach_confirm_summary_row"
                    >
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="deals_suspend_all_modal_message">
                  This investor has not set up a bank account yet. Send them
                  an email with a link to add their bank details in Investing.
                </p>
              )}
              {requestSentTo ? (
                <p className="deal_dist_bank_setup_sent" role="status">
                  Bank setup email sent to {requestSentTo}.
                </p>
              ) : null}
              <p className="deal_dist_bank_setup_note" role="note">
                Account and routing numbers are masked. Set Up means bank
                details are on file; it does not confirm the account is
                verified.
              </p>
            </>
          ) : null}
        </div>

        <ModalFooterActions>
          <ModalFooterTrailing>
            {details?.status === "not_set_up" ? (
              <>
                <ModalCancelButton onClick={onClose} disabled={sendingRequest} />
                <ModalSendButton
                  onClick={() => void sendSetupRequest()}
                  disabled={sendingRequest}
                  busy={sendingRequest}
                  busyLabel="Sending…"
                >
                  {requestSentTo ? "Resend setup email" : "Send setup email"}
                </ModalSendButton>
              </>
            ) : (
              <ModalCloseButton onClick={onClose} />
            )}
          </ModalFooterTrailing>
        </ModalFooterActions>
      </div>
    </div>,
    document.body,
  )
}
