import {
  Briefcase,
  IdCard,
  Loader2,
  Mail,
  Plus,
  Save,
  Tag,
  UserRound,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  DropdownSelect,
  MODAL_DROPDOWN_SELECT_PROPS,
  type DropdownSelectSection,
} from "../../../../../common/components/dropdown-select"
import { toast } from "../../../../../common/components/Toast"
import { AddContactPanel } from "../../../contacts/components/AddContactPanel"
import { createContact, fetchContacts } from "../../../contacts/api/contactsApi"
import type { ContactRow } from "../../../contacts/types/contact.types"
import {
  fetchDealInvestorClasses,
  fetchUsersForMemberSelect,
  postDealLpInvestor,
  putDealLpInvestor,
} from "../../api/dealsApi"
import { getApiV1Base } from "../../../../../common/utils/apiBaseUrl"
import type { AddInvestmentFormValues } from "../deal_members/add-investment/add_deal_member_types"
import { loadAddMemberDraft } from "../deal_members/add-investment/addMemberFormDraftStorage"
import {
  alreadyAddedOptionLabel,
  INVESTOR_ALREADY_ON_DEAL_MESSAGE,
  isContactAlreadyOnDealRoster,
  type RosterRowForDuplicateCheck,
} from "../deal_members/add-investment/dealRosterContactDuplicate"
import { MEMBER_SELECT_OPTIONS } from "../../constants/member-options"
import {
  INVESTOR_PROFILE_SELECT_OPTIONS,
  investorProfileIdFromLabel,
  isLpInvestorRole,
  LP_INVESTOR_ROLE_VALUE,
  LP_INVESTORS_ROLE_LABEL,
} from "../../constants/investor-profile"
import type { DealInvestorRow } from "../../types/deal-investors.types"
import type { DealInvestorClass } from "../../types/deal-investor-class.types"
import { rowDisplayName } from "../../../usermanagement/memberAdminShared"
import { InfoIconPanel } from "../offering_details/FieldInfoHeading"
import { YesNoCardRadioGroup } from "../../../../../common/components/YesNoCardRadioGroup/YesNoCardRadioGroup"
import "../../../contacts/contacts.css"
import "../../../usermanagement/user_management.css"
import "../../components/deal-step-form.css"
import "../deal_members/add-investment/add_deal_modal.css"

const INVESTOR_CLASS_UNAVAILABLE_HINT =
  "Please complete the Classes section to assign an investor class."

const INVITATION_EMAILS_UNAVAILABLE_HINT =
  "Invitation emails are unavailable while the deal is in draft or required deal details are incomplete. Finalize the deal before sending invitations. You can still choose No below."

const PREFIX_CONTACT = "contact:"
const PREFIX_USER = "user:"

const DROPDOWN_TRIGGER_PILL =
  "um_field_select deals_add_inv_field_control deals_add_inv_field_pill"

function lpRosterStorageKey(dealId: string): string {
  const safe = dealId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
  return `portal_lp_roster_id_${safe}`
}

function loadLpRosterId(dealId: string): string | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(lpRosterStorageKey(dealId))
    if (!raw?.trim()) return null
    const p = JSON.parse(raw) as { lpInvestorId?: string }
    const id = p.lpInvestorId?.trim()
    return id || null
  } catch {
    return null
  }
}

function saveLpRosterId(dealId: string, lpInvestorId: string): void {
  try {
    sessionStorage.setItem(
      lpRosterStorageKey(dealId),
      JSON.stringify({ lpInvestorId }),
    )
  } catch {
    /* ignore */
  }
}

function clearLpRosterId(dealId: string): void {
  try {
    sessionStorage.removeItem(lpRosterStorageKey(dealId))
  } catch {
    /* ignore */
  }
}

function lpInvestorRowMissingMessage(message: string | undefined): boolean {
  return /lp investor row not found/i.test(String(message ?? ""))
}

function contactOptionLabel(c: ContactRow): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim()
  if (name && c.email.trim()) return `${name} — ${c.email.trim()}`
  if (c.email.trim()) return c.email.trim()
  return name || "Contact"
}

function buildMemberLabel(u: Record<string, unknown>): string {
  const name = rowDisplayName(u)
  const email = String(u.email ?? "").trim()
  if (name && name !== "—" && email) return `${name} — ${email}`
  if (email) return email
  return name !== "—" ? name : "—"
}

function memberOptionFromUser(
  u: Record<string, unknown>,
): { value: string; label: string } | null {
  const id = String(u.id ?? "").trim()
  if (!id) return null
  const label = buildMemberLabel(u)
  if (label === "—" || label === id) {
    const email = String(u.email ?? "").trim()
    const un = String(u.username ?? "").trim()
    const fallback = email || un || "Member"
    return { value: id, label: fallback }
  }
  return { value: id, label }
}

export interface AddLpInvestorModalProps {
  dealId: string
  open: boolean
  onClose: () => void
  /** After explicit Save (closes modal via parent). */
  onSaved: () => void
  /** Debounced autosave only — refresh list without closing the modal. */
  onListRefresh?: () => void | Promise<void>
  /** Same chrome as add — edit an existing `deal_lp_investor` row from the Investors table. */
  mode?: "add" | "edit"
  editRow?: DealInvestorRow | null
  /** When deal is draft/incomplete, block invitation toggles (same as Add investment). */
  dealBlocksInvitationEmails?: boolean
  /**
   * Investors tab “Continue editing” on the session draft row: restore contact + optional
   * autosaved LP id from `portal_add_member_*` draft (same storage as the full add modal).
   */
  resumeAddMemberDraft?: boolean
  /** Current Investors tab rows — used to block duplicate adds and mark dropdown options. */
  existingInvestorRows?: DealInvestorRow[]
}

function resolveLpInvestorClassId(
  row: DealInvestorRow | null | undefined,
  dealClasses: DealInvestorClass[],
): string {
  if (dealClasses.length === 0) return ""
  if (!row) return dealClasses[0]?.id?.trim() ?? ""
  const raw = row.investorClass?.trim()
  if (!raw || raw === "—") return dealClasses[0]?.id?.trim() ?? ""
  const byId = dealClasses.find((c) => c.id === raw)
  if (byId) return byId.id
  const byName = dealClasses.find(
    (c) => c.name.trim().toLowerCase() === raw.toLowerCase(),
  )
  return byName?.id ?? dealClasses[0]?.id?.trim() ?? ""
}

export function AddLpInvestorModal({
  dealId,
  open,
  onClose,
  onSaved,
  onListRefresh,
  mode = "add",
  editRow = null,
  dealBlocksInvitationEmails = false,
  resumeAddMemberDraft = false,
  existingInvestorRows = [],
}: AddLpInvestorModalProps) {
  const isEditMode = mode === "edit" && editRow != null
  const titleId = useId()
  const [contactId, setContactId] = useState("")
  const [contactDisplayName, setContactDisplayName] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [profileId, setProfileId] = useState("")
  const [sendInvitationMail, setSendInvitationMail] = useState<"yes" | "no">(
    "yes",
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memberRows, setMemberRows] = useState<Record<string, unknown>[]>([])
  const [contactRows, setContactRows] = useState<ContactRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [addContactModalOpen, setAddContactModalOpen] = useState(false)
  const [dealClasses, setDealClasses] = useState<DealInvestorClass[]>([])
  const [investorClassId, setInvestorClassId] = useState("")
  const [backendLpRosterId, setBackendLpRosterId] = useState<string | null>(null)
  const backendLpRosterIdRef = useRef<string | null>(null)
  const lpAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const investorRosterForGate = useMemo((): RosterRowForDuplicateCheck[] => {
    return existingInvestorRows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      userEmail: r.userEmail,
    }))
  }, [existingInvestorRows])

  const excludeRowIdForDuplicateGate = useMemo(() => {
    if (isEditMode && editRow?.id) return editRow.id.trim()
    const lp = backendLpRosterId?.trim() || loadLpRosterId(dealId)?.trim()
    return lp || null
  }, [isEditMode, editRow?.id, backendLpRosterId, dealId])

  const selectedContactAlreadyOnDeal = useMemo(
    () =>
      !isEditMode &&
      Boolean(contactId.trim()) &&
      isContactAlreadyOnDealRoster(
        investorRosterForGate,
        contactId.trim(),
        contactEmail,
        excludeRowIdForDuplicateGate,
      ),
    [
      isEditMode,
      contactId,
      contactEmail,
      investorRosterForGate,
      excludeRowIdForDuplicateGate,
    ],
  )
  const lpPostInFlightRef = useRef(false)
  const lpAutosaveInFlightRef = useRef(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setMembersLoading(true)
    void (async () => {
      const [users, contacts, classes] = await Promise.all([
        fetchUsersForMemberSelect(),
        fetchContacts(),
        fetchDealInvestorClasses(dealId),
      ])
      if (cancelled) return
      setMemberRows(users)
      setContactRows(contacts)
      setDealClasses(classes)
      setMembersLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, dealId])

  useEffect(() => {
    if (!open) setAddContactModalOpen(false)
  }, [open])

  const investorClassOptions = useMemo(
    () =>
      dealClasses.map((c) => ({
        value: c.id,
        label: c.name?.trim() || c.id,
      })),
    [dealClasses],
  )

  const noDealClasses = dealClasses.length === 0

  useEffect(() => {
    if (!open) {
      setContactId("")
      setContactDisplayName("")
      setContactEmail("")
      setProfileId("")
      setInvestorClassId("")
      setSendInvitationMail("yes")
      setError(null)
      setBackendLpRosterId(null)
      backendLpRosterIdRef.current = null
      return
    }
    if (isEditMode && editRow) {
      setContactId(editRow.contactId?.trim() ?? "")
      setContactDisplayName(editRow.displayName?.trim() ?? "")
      setContactEmail(
        editRow.userEmail && editRow.userEmail !== "—"
          ? editRow.userEmail.trim()
          : "",
      )
      setProfileId(
        editRow.profileId?.trim() ||
          investorProfileIdFromLabel(editRow.entitySubtitle ?? "") ||
          "",
      )
      setSendInvitationMail("no")
      setInvestorClassId(resolveLpInvestorClassId(editRow, dealClasses))
      setError(null)
      setBackendLpRosterId(editRow.id)
      backendLpRosterIdRef.current = editRow.id
      return
    }
    if (resumeAddMemberDraft) {
      const draft = loadAddMemberDraft(dealId)
      const f = draft?.form
      if (
        f &&
        isLpInvestorRole(f.investorRole ?? "") &&
        f.contactId?.trim()
      ) {
        setContactId(f.contactId.trim())
        setContactDisplayName(f.contactDisplayName?.trim() ?? "")
        setContactEmail(f.contactEmail?.trim() ?? "")
        if (!dealBlocksInvitationEmails && f.sendInvitationMail === "yes")
          setSendInvitationMail("yes")
        else setSendInvitationMail("no")
        setProfileId(String(f.profileId ?? "").trim())
        const draftClassRaw = String(f.investorClass ?? "").trim()
        if (draftClassRaw && dealClasses.some((c) => c.id === draftClassRaw)) {
          setInvestorClassId(draftClassRaw)
        } else if (draftClassRaw) {
          const byName = dealClasses.find(
            (c) =>
              c.name.trim().toLowerCase() === draftClassRaw.toLowerCase(),
          )
          setInvestorClassId(byName?.id ?? dealClasses[0]?.id ?? "")
        } else {
          setInvestorClassId(dealClasses[0]?.id ?? "")
        }
        setError(null)
        /** Only `deal_lp_investor` ids — never `backendInvestmentId` (different table / PUT route). */
        const bid = draft?.backendLpInvestorId?.trim()
        if (bid) {
          setBackendLpRosterId(bid)
          backendLpRosterIdRef.current = bid
          saveLpRosterId(dealId, bid)
        } else {
          clearLpRosterId(dealId)
          setBackendLpRosterId(null)
          backendLpRosterIdRef.current = null
        }
        return
      }
    }
    setContactId("")
    setContactDisplayName("")
    setContactEmail("")
    setProfileId("")
    setInvestorClassId(dealClasses[0]?.id ?? "")
    setSendInvitationMail(dealBlocksInvitationEmails ? "no" : "yes")
    setError(null)
    const stored = loadLpRosterId(dealId)
    if (stored) {
      setBackendLpRosterId(stored)
      backendLpRosterIdRef.current = stored
    } else {
      setBackendLpRosterId(null)
      backendLpRosterIdRef.current = null
    }
  }, [
    open,
    dealId,
    isEditMode,
    editRow,
    resumeAddMemberDraft,
    dealBlocksInvitationEmails,
    dealClasses,
  ])

  useEffect(() => {
    if (!open || dealClasses.length === 0) return
    if (isEditMode && editRow) {
      const resolved = resolveLpInvestorClassId(editRow, dealClasses)
      setInvestorClassId((prev) => {
        if (prev && dealClasses.some((c) => c.id === prev)) return prev
        return resolved
      })
      return
    }
    setInvestorClassId((prev) => {
      if (prev && dealClasses.some((c) => c.id === prev)) return prev
      return dealClasses[0]?.id ?? ""
    })
  }, [open, isEditMode, editRow, dealClasses])

  const patchMemberById = useCallback(
    (raw: string) => {
      if (!raw) {
        setContactId("")
        setContactDisplayName("")
        setContactEmail("")
        setError(null)
        return
      }
      if (raw.startsWith(PREFIX_CONTACT)) {
        const id = raw.slice(PREFIX_CONTACT.length)
        const c = contactRows.find((x) => x.id === id)
        if (c) {
          const email = c.email.trim()
          if (
            !isEditMode &&
            isContactAlreadyOnDealRoster(
              investorRosterForGate,
              id,
              email,
              excludeRowIdForDuplicateGate,
            )
          ) {
            setError(INVESTOR_ALREADY_ON_DEAL_MESSAGE)
            toast.error("Investor already on this deal", INVESTOR_ALREADY_ON_DEAL_MESSAGE)
            return
          }
          const display = contactOptionLabel(c)
          setContactId(id)
          setContactDisplayName(display.split(" — ")[0]?.trim() || display)
          setContactEmail(email)
          setError(null)
        }
        return
      }
      const userId = raw.startsWith(PREFIX_USER)
        ? raw.slice(PREFIX_USER.length)
        : raw
      const u = memberRows.find((x) => String(x.id) === userId)
      if (u) {
        const email = String(u.email ?? "").trim()
        if (
          !isEditMode &&
          isContactAlreadyOnDealRoster(
            investorRosterForGate,
            userId,
            email,
            excludeRowIdForDuplicateGate,
          )
        ) {
          setError(INVESTOR_ALREADY_ON_DEAL_MESSAGE)
          toast.error("Investor already on this deal", INVESTOR_ALREADY_ON_DEAL_MESSAGE)
          return
        }
        const display =
          rowDisplayName(u) !== "—"
            ? rowDisplayName(u)
            : email || "—"
        setContactId(userId)
        setContactDisplayName(display)
        setContactEmail(email)
        setError(null)
        return
      }
      const fallbackOpt = MEMBER_SELECT_OPTIONS.find((o) => o.value === userId)
      if (fallbackOpt?.value) {
        const parts = fallbackOpt.label.split(" — ")
        const email = parts[1]?.trim() ?? ""
        if (
          !isEditMode &&
          isContactAlreadyOnDealRoster(
            investorRosterForGate,
            userId,
            email,
            excludeRowIdForDuplicateGate,
          )
        ) {
          setError(INVESTOR_ALREADY_ON_DEAL_MESSAGE)
          toast.error("Investor already on this deal", INVESTOR_ALREADY_ON_DEAL_MESSAGE)
          return
        }
        setContactId(userId)
        setContactDisplayName(parts[0]?.trim() || userId)
        setContactEmail(email)
        setError(null)
        return
      }
      setContactId(userId)
      setContactDisplayName("")
      setContactEmail("")
      setError(null)
    },
    [
      contactRows,
      memberRows,
      isEditMode,
      investorRosterForGate,
      excludeRowIdForDuplicateGate,
    ],
  )

  const memberSelectValue = useMemo(() => {
    const id = contactId.trim()
    if (!id) return ""
    if (contactRows.some((c) => c.id === id)) return `${PREFIX_CONTACT}${id}`
    if (memberRows.some((u) => String(u.id) === id))
      return `${PREFIX_USER}${id}`
    if (MEMBER_SELECT_OPTIONS.some((o) => o.value === id))
      return `${PREFIX_USER}${id}`
    return id
  }, [contactId, contactRows, memberRows])

  const memberDropdownSections = useMemo((): DropdownSelectSection[] => {
    function isAlreadyOnInvestorsList(
      contactOrUserId: string,
      email: string,
    ): boolean {
      return isContactAlreadyOnDealRoster(
        investorRosterForGate,
        contactOrUserId,
        email,
        excludeRowIdForDuplicateGate,
      )
    }

    const sections: DropdownSelectSection[] = []
    if (contactRows.length > 0) {
      sections.push({
        heading: "Contacts",
        options: contactRows.map((c) => {
          const value = `${PREFIX_CONTACT}${c.id}`
          const baseLabel = contactOptionLabel(c)
          const onDeal = isAlreadyOnInvestorsList(c.id, c.email ?? "")
          return {
            value,
            label: baseLabel,
            disabled: onDeal,
            ...(onDeal ? { labelContent: alreadyAddedOptionLabel(baseLabel) } : {}),
          }
        }),
      })
    }
    if (memberRows.length > 0) {
      sections.push({
        heading: "Directory members",
        options: memberRows
          .map((u) => memberOptionFromUser(u))
          .filter((o): o is { value: string; label: string } => Boolean(o))
          .map((o) => {
            const value = `${PREFIX_USER}${o.value}`
            const dirRow = memberRows.find((x) => String(x.id) === o.value)
            const email = dirRow ? String(dirRow.email ?? "").trim() : ""
            const onDeal = isAlreadyOnInvestorsList(o.value, email)
            return {
              value,
              label: o.label,
              disabled: onDeal,
              ...(onDeal
                ? { labelContent: alreadyAddedOptionLabel(o.label) }
                : {}),
            }
          }),
      })
    }
    return sections
  }, [
    contactRows,
    memberRows,
    investorRosterForGate,
    excludeRowIdForDuplicateGate,
  ])

  const handleContactCreated = useCallback((contact: ContactRow) => {
    setContactRows((prev) => {
      if (prev.some((c) => c.id === contact.id)) return prev
      return [...prev, contact]
    })
    const display = contactOptionLabel(contact)
    const namePart = display.split(" — ")[0]?.trim() || display
    setContactId(contact.id)
    setContactDisplayName(namePart)
    setContactEmail(contact.email.trim())
    toast.success(
      "Contact added",
      `${namePart} is selected as the investor for this deal.`,
    )
  }, [])

  const handleAddContactSave = useCallback(
    async (contact: Omit<ContactRow, "id" | "createdByDisplayName">) => {
      const created = await createContact(contact)
      handleContactCreated(created)
    },
    [handleContactCreated],
  )

  backendLpRosterIdRef.current = backendLpRosterId

  useEffect(() => {
    if (!getApiV1Base()) return
    if (!open) return
    if (dealClasses.length === 0) return
    const hasContent =
      contactId.trim().length > 0 || sendInvitationMail === "yes"
    if (!hasContent) return
    if (selectedContactAlreadyOnDeal) return

    if (lpAutosaveTimerRef.current)
      clearTimeout(lpAutosaveTimerRef.current)
    lpAutosaveTimerRef.current = setTimeout(() => {
      lpAutosaveTimerRef.current = null
      void (async () => {
        const classId = investorClassId.trim()
        if (!classId) return
        const values: AddInvestmentFormValues = {
          offeringId: "primary",
          contactId: contactId.trim(),
          contactDisplayName: contactDisplayName.trim(),
          contactEmail: contactEmail.trim() || undefined,
          profileId: profileId.trim(),
          investorRole: LP_INVESTOR_ROLE_VALUE,
          status: "",
          fundApproved: false,
          investorClass: classId,
          docSignedDate: "",
          commitmentAmount: "0",
          extraContributionAmounts: [],
          documentFileName: null,
          sendInvitationMail: dealBlocksInvitationEmails
            ? "no"
            : sendInvitationMail,
        }
        const rosterId = backendLpRosterIdRef.current
        if (lpAutosaveInFlightRef.current) return
        if (rosterId) {
          lpAutosaveInFlightRef.current = true
          try {
            let result = await putDealLpInvestor(dealId, rosterId, values, {
              autosave: true,
            })
            if (
              !result.ok &&
              !isEditMode &&
              lpInvestorRowMissingMessage(result.message)
            ) {
              clearLpRosterId(dealId)
              backendLpRosterIdRef.current = null
              setBackendLpRosterId(null)
              result = await postDealLpInvestor(dealId, values, {
                autosave: true,
              })
              if (result.ok && result.mode === "api" && result.lpInvestorId) {
                backendLpRosterIdRef.current = result.lpInvestorId
                setBackendLpRosterId(result.lpInvestorId)
                saveLpRosterId(dealId, result.lpInvestorId)
              }
            }
            if (result.ok && result.mode === "api") void onListRefresh?.()
          } finally {
            lpAutosaveInFlightRef.current = false
          }
          return
        }
        if (lpPostInFlightRef.current) return
        if (isEditMode) return
        lpPostInFlightRef.current = true
        lpAutosaveInFlightRef.current = true
        try {
          const result = await postDealLpInvestor(dealId, values, {
            autosave: true,
          })
          if (result.ok && result.mode === "api" && result.lpInvestorId) {
            backendLpRosterIdRef.current = result.lpInvestorId
            setBackendLpRosterId(result.lpInvestorId)
            saveLpRosterId(dealId, result.lpInvestorId)
          }
          if (result.ok && result.mode === "api") void onListRefresh?.()
        } finally {
          lpPostInFlightRef.current = false
          lpAutosaveInFlightRef.current = false
        }
      })()
    }, 1200)
    return () => {
      if (lpAutosaveTimerRef.current) {
        clearTimeout(lpAutosaveTimerRef.current)
        lpAutosaveTimerRef.current = null
      }
    }
  }, [
    open,
    dealId,
    dealClasses,
    contactId,
    contactDisplayName,
    contactEmail,
    sendInvitationMail,
    onListRefresh,
    investorClassId,
    isEditMode,
    dealBlocksInvitationEmails,
    profileId,
    selectedContactAlreadyOnDeal,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!contactId.trim()) {
      setError("Select an investor.")
      return
    }
    if (selectedContactAlreadyOnDeal) {
      setError(INVESTOR_ALREADY_ON_DEAL_MESSAGE)
      toast.error("Investor already on this deal", INVESTOR_ALREADY_ON_DEAL_MESSAGE)
      return
    }
    if (dealClasses.length === 0) {
      setError(
        "Add at least one investor class in Offering Details before adding an LP investor.",
      )
      return
    }
    const classId = investorClassId.trim()
    if (!classId) {
      setError("Select an investor class.")
      return
    }
    if (!dealClasses.some((c) => c.id === classId)) {
      setError("Select a valid investor class from this deal.")
      return
    }
    if (
      !dealBlocksInvitationEmails &&
      sendInvitationMail === "yes" &&
      !profileId.trim()
    ) {
      setError(
        "Select an investor profile before choosing to send the invitation email.",
      )
      return
    }

    const values: AddInvestmentFormValues = {
      offeringId: "primary",
      contactId: contactId.trim(),
      contactDisplayName: contactDisplayName.trim(),
      contactEmail: contactEmail.trim() || undefined,
      profileId: profileId.trim(),
      investorRole: LP_INVESTOR_ROLE_VALUE,
      status: "",
      fundApproved: false,
      investorClass: classId,
      docSignedDate: "",
      commitmentAmount: "0",
      extraContributionAmounts: [],
      documentFileName: null,
      sendInvitationMail: dealBlocksInvitationEmails ? "no" : sendInvitationMail,
    }

    setSubmitting(true)
    try {
      let existingId =
        backendLpRosterIdRef.current ?? loadLpRosterId(dealId)
      let result = existingId
        ? await putDealLpInvestor(dealId, existingId, values)
        : await postDealLpInvestor(dealId, values)
      if (
        !result.ok &&
        existingId &&
        !isEditMode &&
        lpInvestorRowMissingMessage(result.message)
      ) {
        clearLpRosterId(dealId)
        backendLpRosterIdRef.current = null
        setBackendLpRosterId(null)
        result = await postDealLpInvestor(dealId, values)
        existingId = ""
      }
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (!isEditMode) {
        clearLpRosterId(dealId)
        backendLpRosterIdRef.current = null
        setBackendLpRosterId(null)
      }
      onSaved()
      onClose()
    } catch {
      setError("Could not save. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <>
    <div
      className="um_modal_overlay deals_add_inv_modal_overlay portal_modal_z_boost"
      role="presentation"
    >
      <div
        className="um_modal um_modal_view deals_add_inv_modal_panel add_contact_panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="um_modal_head add_contact_modal_head">
          <h3 id={titleId} className="um_modal_title add_contact_modal_title">
            {isEditMode ? "Edit investor" : "Add Investors"}
          </h3>
          <button
            type="button"
            className="um_modal_close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <form
          className="deals_add_inv_modal_form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="deals_add_inv_modal_scroll">
            {error ? (
              <p className="um_msg_error um_modal_form_error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="add_contact_section">
              <div className="um_field">
                <label htmlFor="lp-inv-member" className="um_field_label_row">
                  <UserRound className="um_field_label_icon" size={17} aria-hidden />
                  <span>Investors</span>
                </label>
                <DropdownSelect
                  {...MODAL_DROPDOWN_SELECT_PROPS}
                  id="lp-inv-member"
                  sections={memberDropdownSections}
                  value={memberSelectValue}
                  disabled={membersLoading}
                  onChange={(v) => patchMemberById(v)}
                  placeholder={
                    membersLoading
                      ? "Loading contacts and members…"
                      : "Select contact or member"
                  }
                  ariaLabel="Investor or contact"
                  header={{
                    label: "+ Add Contact",
                    onClick: () => setAddContactModalOpen(true),
                  }}
                  triggerClassName={DROPDOWN_TRIGGER_PILL}
                />
                {selectedContactAlreadyOnDeal ? (
                  <p className="um_msg_error deals_add_inv_field_hint" role="alert">
                    {INVESTOR_ALREADY_ON_DEAL_MESSAGE}
                  </p>
                ) : null}
              </div>

              <div className="um_field">
                <label htmlFor="lp-inv-role" className="um_field_label_row">
                  <Briefcase className="um_field_label_icon" size={17} aria-hidden />
                  <span>Role</span>
                </label>
                <input
                  id="lp-inv-role"
                  type="text"
                  readOnly
                  className="deals_add_inv_field_pill deals_lp_inv_role_readonly"
                  value={LP_INVESTORS_ROLE_LABEL}
                  aria-readonly="true"
                />
              </div>

              <div className="um_field">
                <label htmlFor="lp-inv-profile" className="um_field_label_row">
                  <IdCard className="um_field_label_icon" size={17} aria-hidden />
                  <span>Profile</span>
                </label>
                <DropdownSelect
                  {...MODAL_DROPDOWN_SELECT_PROPS}
                  id="lp-inv-profile"
                  options={INVESTOR_PROFILE_SELECT_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  value={profileId}
                  onChange={(v) => setProfileId(v)}
                  placeholder="Select profile"
                  ariaLabel="Profile"
                  ariaDescribedBy="lp-inv-profile-hint"
                  triggerClassName={DROPDOWN_TRIGGER_PILL}
                />
                <p
                  id="lp-inv-profile-hint"
                  className="deals_add_inv_section_hint"
                  role="note"
                >
                  Used for investor identity and invitation email context when you notify
                  them about being added to the deal.
                </p>
              </div>

              <div className="um_field">
                <label htmlFor="lp-inv-class" className="um_field_label_row">
                  <Tag className="um_field_label_icon" size={17} aria-hidden />
                  <span>Investor class</span>
                  {noDealClasses ? (
                    <span className="deals_add_inv_label_info">
                      <InfoIconPanel
                        ariaLabel="More information: Investor class"
                        infoContent={INVESTOR_CLASS_UNAVAILABLE_HINT}
                      />
                    </span>
                  ) : null}
                </label>
                <DropdownSelect
                  {...MODAL_DROPDOWN_SELECT_PROPS}
                  id="lp-inv-class"
                  options={investorClassOptions}
                  value={investorClassId}
                  disabled={noDealClasses}
                  onChange={(v) => setInvestorClassId(v)}
                  placeholder="Select investor class"
                  ariaLabel="Investor class"
                  ariaDescribedBy={
                    noDealClasses ? "lp-inv-class-hint" : undefined
                  }
                  triggerClassName={DROPDOWN_TRIGGER_PILL}
                />
                {noDealClasses ? (
                  <p id="lp-inv-class-hint" className="visually_hidden">
                    {INVESTOR_CLASS_UNAVAILABLE_HINT}
                  </p>
                ) : null}
              </div>

              <div className="um_field">
                <div
                  className="um_field_label_row"
                  id="lp-inv-send-invite-label"
                >
                  <Mail
                    className="um_field_label_icon"
                    size={17}
                    aria-hidden
                  />
                  <span className="mail_text_label">
                    Would you like to notify the investor about their addition to
                    the deal?
                  </span>
                  {dealBlocksInvitationEmails ? (
                    <span className="deals_add_inv_label_info">
                      <InfoIconPanel
                        ariaLabel="More information: Invitation emails"
                        infoContent={
                          <>
                            Invitation emails are unavailable while the deal is in
                            draft or required deal details are incomplete. Finalize
                            the deal before sending invitations. You can still choose{" "}
                            <strong>No</strong> below.
                          </>
                        }
                      />
                    </span>
                  ) : null}
                </div>
                {dealBlocksInvitationEmails ? (
                  <p id="lp-inv-send-invite-hint" className="visually_hidden">
                    {INVITATION_EMAILS_UNAVAILABLE_HINT}
                  </p>
                ) : null}
                <div className="portal_yesno_field_block">
                  <YesNoCardRadioGroup
                    name="lp-inv-send-invitation"
                    value={sendInvitationMail}
                    onChange={setSendInvitationMail}
                    yesIsCommon
                    variant="mail"
                    disabled={dealBlocksInvitationEmails}
                    ariaLabelledBy="lp-inv-send-invite-label"
                    ariaDescribedBy={
                      dealBlocksInvitationEmails
                        ? "lp-inv-send-invite-hint"
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="um_modal_actions add_contact_modal_actions">
            <button
              type="button"
              className="um_btn_secondary"
              onClick={onClose}
              disabled={submitting}
            >
              <X size={16} strokeWidth={2} aria-hidden />
              Close
            </button>
            <button
              type="submit"
              className="um_btn_primary"
              disabled={submitting || selectedContactAlreadyOnDeal}
            >
              {submitting ? (
                <>
                  <Loader2
                    size={16}
                    strokeWidth={2}
                    className="add_contact_modal_btn_spin"
                    aria-hidden
                  />
                  {isEditMode ? "Saving…" : "Adding…"}
                </>
              ) : (
                <>
                  {isEditMode ? (
                    <Save size={16} strokeWidth={2} aria-hidden />
                  ) : (
                    <Plus size={16} strokeWidth={2} aria-hidden />
                  )}
                  {isEditMode ? "Save" : "Add"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    <AddContactPanel
      open={addContactModalOpen}
      onClose={() => setAddContactModalOpen(false)}
      onSave={handleAddContactSave}
      contactToEdit={null}
      existingContacts={contactRows}
    />
    </>
  )
}
