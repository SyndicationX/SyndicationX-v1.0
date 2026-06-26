import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "@/common/components/Toast"
import {
  type ProfileBookSnapshot,
  fetchMyProfileBook,
  postInvestorProfile,
} from "./investingProfileBookApi"
import { AddInvestorProfileModal } from "./AddInvestorProfileModal"
import type {
  InvestorProfileListRow,
  NewInvestorProfilePayload,
} from "./investor-profiles.types"
import type { SavedAddress } from "./address.types"
import "@/modules/Syndication/usermanagement/user_management.css"
import "@/modules/Syndication/Deals/deals-list.css"
import "@/modules/Syndication/Deals/deals-create.css"
import "./add-investor-profile-modal.css"

/**
 * Full-page add profile (same shell as Create deal) — route `/investing/profiles/add`.
 * Layout, header, stepper, and section are rendered by `AddInvestorProfileModal` (page variant).
 */
export function AddInvestorProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (
    location.state as { returnTo?: string } | null
  )?.returnTo?.trim()
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([])
  const [savedBeneficiaries, setSavedBeneficiaries] = useState<
    ProfileBookSnapshot["beneficiaries"]
  >([])
  const [existingProfiles, setExistingProfiles] = useState<InvestorProfileListRow[]>(
    [],
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const book = await fetchMyProfileBook()
        if (!cancelled) {
          setSavedAddresses(book.addresses)
          setSavedBeneficiaries(book.beneficiaries)
          setExistingProfiles(book.profiles)
        }
      } catch {
        if (!cancelled) {
          setSavedAddresses([])
          setSavedBeneficiaries([])
          setExistingProfiles([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const goBack = useCallback(() => {
    navigate(returnTo || "/investing/profiles")
  }, [navigate, returnTo])

  const onProfileCreated = useCallback(
    async (p: NewInvestorProfilePayload) => {
      await postInvestorProfile(p)
      toast.success("Profile added", "Your new profile was saved.")
      navigate(returnTo || "/investing/profiles")
    },
    [navigate, returnTo],
  )

  if (loading) {
    return (
      <div className="deals_list_page deals_detail_page deals_add_investor_class_page deals_add_deal_asset_page deals_create_flow">
        <section
          className="deals_create_loading_panel"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2
            className="deals_create_loading_icon"
            size={28}
            strokeWidth={2}
            aria-hidden
          />
          <p className="deals_create_loading_text">Loading…</p>
        </section>
      </div>
    )
  }

  return (
    <AddInvestorProfileModal
      open
      variant="page"
      onClose={goBack}
      savedAddresses={savedAddresses}
      savedBeneficiaries={savedBeneficiaries}
      existingProfiles={existingProfiles}
      onAddressAdded={(row) => setSavedAddresses((prev) => [row, ...prev])}
      onBeneficiaryAdded={(row) => setSavedBeneficiaries((prev) => [row, ...prev])}
      onProfileCreated={onProfileCreated}
    />
  )
}
