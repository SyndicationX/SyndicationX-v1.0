import { useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2, Users, X } from "lucide-react"
import "../../components/deal-stage-change-modal.css"
import {
  fetchInvestorSponsorOptions,
  updateInvestorSponsor,
  type InvestorSponsorOption,
} from "../../api/dealsApi"

export function UpdateInvestorSponsorModal({
  dealId,
  investorRowId,
  investorName,
  onClose,
  onSaved,
}: {
  dealId: string
  investorRowId: string
  investorName: string
  onClose: () => void
  onSaved: (sponsor: { displayName: string; email: string; userId: string }) => void
}) {
  const titleId = useId()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [sponsors, setSponsors] = useState<InvestorSponsorOption[]>([])
  const [sponsorUserId, setSponsorUserId] = useState("")
  const [initialSponsorUserId, setInitialSponsorUserId] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    void fetchInvestorSponsorOptions(dealId, investorRowId).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setCompanyName(result.companyName)
      setSponsors(result.sponsors)
      setSponsorUserId(result.currentSponsorUserId)
      setInitialSponsorUserId(result.currentSponsorUserId)
    })
    return () => {
      cancelled = true
    }
  }, [dealId, investorRowId])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [busy, onClose])

  if (typeof document === "undefined") return null
  const unchanged =
    sponsorUserId.trim().toLowerCase() ===
    initialSponsorUserId.trim().toLowerCase()
  const companyLabel = companyName.trim() || "this sponsor company"
  const displayName = investorName.trim() || "this investor"

  async function save() {
    if (!sponsorUserId || busy || unchanged) return
    setBusy(true)
    setError("")
    const result = await updateInvestorSponsor(
      dealId,
      investorRowId,
      sponsorUserId,
    )
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const chosen = sponsors.find((s) => s.userId === sponsorUserId)
    onSaved({
      userId: sponsorUserId,
      displayName: chosen?.displayName || "the selected sponsor",
      email: chosen?.email || "",
    })
  }

  return createPortal(
    <div
      className="deal_stage_modal_overlay portal_modal_z_boost"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="deal_stage_modal deal_stage_modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="deal_stage_modal_head">
          <div className="deal_stage_modal_icon_wrap" aria-hidden>
            <Users size={22} strokeWidth={2} />
          </div>
          <div className="deal_stage_modal_head_text">
            <p className="deal_stage_modal_eyebrow">Investors</p>
            <h2 id={titleId} className="deal_stage_modal_title">
              Update sponsor
            </h2>
          </div>
          <button
            type="button"
            className="deal_stage_modal_close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <form
          className="deal_stage_modal_form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="deal_stage_modal_body">
            <p className="deal_stage_modal_desc">
              Choose a sponsor for <strong>{displayName}</strong> from{" "}
              <strong>{companyLabel}</strong>.
            </p>
            {loading ? (
              <p className="deal_stage_modal_desc deal_stage_modal_status">
                Loading sponsors…
              </p>
            ) : (
              <label className="deal_stage_modal_field">
                <span>Sponsor</span>
                <select
                  value={sponsorUserId}
                  disabled={busy || sponsors.length === 0}
                  autoFocus
                  onChange={(e) => setSponsorUserId(e.target.value)}
                >
                  {sponsors.length === 0 ? (
                    <option value="">No sponsors in this company</option>
                  ) : null}
                  {sponsors.map((sponsor) => (
                    <option key={sponsor.userId} value={sponsor.userId}>
                      {sponsor.email
                        ? `${sponsor.displayName} — ${sponsor.email}`
                        : sponsor.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error ? (
              <p className="deal_saas_paywall_error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="deal_stage_modal_actions">
            <button
              type="button"
              className="deal_stage_modal_btn deal_stage_modal_btn--cancel"
              disabled={busy}
              onClick={onClose}
            >
              <X size={16} strokeWidth={2} aria-hidden />
              Cancel
            </button>
            <button
              type="submit"
              className="deal_stage_modal_btn deal_stage_modal_btn--confirm"
              disabled={busy || loading || unchanged || !sponsorUserId}
            >
              {busy ? (
                <Loader2
                  size={16}
                  strokeWidth={2}
                  className="deal_stage_modal_spin"
                  aria-hidden
                />
              ) : (
                <Users size={16} strokeWidth={2} aria-hidden />
              )}
              {busy ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
