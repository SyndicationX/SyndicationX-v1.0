import {
  Briefcase,
  Clock,
  FileText,
  List,
  Mail,
  Pencil,
  PenLine,
  Phone,
  Tag,
  User,
  Users,
  X,
} from "lucide-react"
import { useEffect } from "react"
import { ViewReadonlyField } from "../../../../common/components/ViewReadonlyField"
import { formatUsPhoneStoredForUi } from "../../../../common/phone/usPhoneNumber"
import "../../Deals/tabs/investors/add-investment-modal.css"
import "../../usermanagement/user_management.css"
import "../contacts.css"
import type { ContactRow } from "../types/contact.types"
import { formatContactSinceLabel } from "../utils/contactCsv"

type ViewContactModalProps = {
  contact: ContactRow | null
  onClose: () => void
  /** Opens the edit panel for this contact (after view closes). */
  onEdit?: () => void
}

function formatList(values: string[]): string {
  if (!values.length) return "—"
  return values.join(", ")
}

export function ViewContactModal({
  contact,
  onClose,
  onEdit,
}: ViewContactModalProps) {
  useEffect(() => {
    if (!contact) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [contact])

  useEffect(() => {
    if (!contact) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [contact, onClose])

  if (!contact) return null

  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    "—"

  return (
    <div
      className="um_modal_overlay portal_modal_z_boost contacts_view_modal_overlay"
      role="presentation"
    >
      <div
        className="um_modal um_modal_view deals_add_inv_modal_panel contacts_view_modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-view-title"
      >
        <div className="um_modal_head">
          <h3 id="contacts-view-title" className="um_modal_title">
            Contact details
          </h3>
          <button
            type="button"
            className="um_modal_close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="deals_add_inv_modal_scroll">
          <div className="um_view_grid contacts_view_modal_grid">
            <ViewReadonlyField
              Icon={User}
              label="Name"
              value={displayName}
            />
            <ViewReadonlyField Icon={Mail} label="Email" value={contact.email || "—"} />
            <ViewReadonlyField
              Icon={Phone}
              label="Phone"
              value={formatUsPhoneStoredForUi(contact.phone)}
            />
            <ViewReadonlyField
              Icon={Briefcase}
              label="Deals"
              value={
                <span title="Distinct syndication deals where a portal member with this contact’s email has an investment.">
                  {String(contact.dealCount ?? 0)}
                </span>
              }
            />
            <ViewReadonlyField
              Icon={FileText}
              label="Note"
              value={contact.note?.trim() ? contact.note : "—"}
            />
            <ViewReadonlyField
              Icon={Tag}
              label="Contact tags"
              value={
                contact.tags.length > 0 ? (
                  <div className="contacts_cell_chips">
                    {contact.tags.map((t, i) => (
                      <span key={`${t}-${i}`} className="contacts_cell_chip">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  "—"
                )
              }
            />
            <ViewReadonlyField
              Icon={List}
              label="Lists"
              value={formatList(contact.lists)}
            />
            <ViewReadonlyField
              Icon={Users}
              label="Owners"
              value={
                contact.owners.length > 0 ? (
                  <div className="contacts_cell_chips">
                    {contact.owners.map((o, i) => (
                      <span key={`${o}-${i}`} className="contacts_cell_chip">
                        {o}
                      </span>
                    ))}
                  </div>
                ) : (
                  "—"
                )
              }
            />
            <ViewReadonlyField
              Icon={User}
              label="Added by"
              value={contact.createdByDisplayName?.trim() || "—"}
            />
            <ViewReadonlyField
              Icon={Clock}
              label="Since"
              value={formatContactSinceLabel(contact.createdAt)}
            />
            <ViewReadonlyField
              Icon={PenLine}
              label="Reason for last change"
              value={contact.lastEditReason?.trim() ? contact.lastEditReason : "—"}
            />
          </div>
        </div>

        <div className="um_modal_actions um_modal_actions_view contacts_view_modal_footer">
          <button
            type="button"
            className="um_btn_secondary"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden />
            Close
          </button>
          {onEdit ? (
            <button type="button" className="um_btn_primary" onClick={onEdit}>
              <Pencil size={16} strokeWidth={2} aria-hidden />
              Edit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
