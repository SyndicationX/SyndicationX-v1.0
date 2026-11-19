import { Building2, CalendarClock, Mail, UserPlus } from "lucide-react"
import { ViewReadonlyField } from "../../../common/components/ViewReadonlyField"
import { formatDateDdMmmYyyy } from "../../../common/utils/formatDateDisplay"
import {
  memberInvitationAt,
  memberInvitationStatus,
  type OrganizationDisplayScope,
} from "./memberAdminShared"
import { UserOrganizationsCell } from "./UserOrganizationsCell"

function invitedByLabel(row: Record<string, unknown>): string {
  const name = String(
    row.invitedByDisplayName ?? row.invited_by_display_name ?? "",
  ).trim()
  return name || "Self signup"
}

function invitationDateTime(row: Record<string, unknown>): string {
  const raw = memberInvitationAt(row)
  if (raw == null || raw === "") return "—"
  const date = formatDateDdMmmYyyy(raw)
  const parsed = raw instanceof Date ? raw : new Date(String(raw))
  if (Number.isNaN(parsed.getTime()) || date === "—") return date
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
  return `${date} ${time}`
}

function InvitationStatus({ row }: { row: Record<string, unknown> }) {
  const { positive, label, dotTone } = memberInvitationStatus(row)
  const dotClass =
    dotTone === "invited"
      ? "um_status_dot um_status_dot_invited"
      : positive
        ? "um_status_dot um_status_dot_active"
        : "um_status_dot um_status_dot_inactive"
  return (
    <span className="um_status_cell">
      <span className={dotClass} aria-hidden />
      <span className="um_status_label">{label}</span>
    </span>
  )
}

/** Invitation block on the member details view. */
export function MemberInvitationSection({
  row,
  organizationScope,
}: {
  row: Record<string, unknown>
  organizationScope?: OrganizationDisplayScope | null
}) {
  return (
    <section className="um_view_invitation" aria-label="Invitation information">
      <h4 className="um_view_section_label">Invitation information</h4>
      <div className="um_view_grid">
        <ViewReadonlyField
          Icon={Building2}
          label="Organization"
          value={
            <UserOrganizationsCell
              row={row}
              organizationScope={organizationScope}
            />
          }
        />
        <ViewReadonlyField
          Icon={UserPlus}
          label="Invited by"
          value={invitedByLabel(row)}
        />
        <ViewReadonlyField
          Icon={CalendarClock}
          label="Invitation date"
          value={invitationDateTime(row)}
        />
        <ViewReadonlyField
          Icon={Mail}
          label="Invitation status"
          value={<InvitationStatus row={row} />}
        />
      </div>
    </section>
  )
}
