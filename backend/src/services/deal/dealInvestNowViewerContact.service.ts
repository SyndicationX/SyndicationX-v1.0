import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database/db.js";
import { contact, dealMember, users } from "../../schema/schema.js";
import {
  dealLpInvestor,
  type DealLpInvestorRow,
} from "../../schema/deal.schema/deal-lp-investor.schema.js";
import { findInviteAttributedContactId } from "../contact/investorInviteLink.service.js";

const CONTACT_MEMBER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedEmail(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim().toLowerCase();
  return t.includes("@") ? t : null;
}

/**
 * Same resolution as `resolveEmailForContactMemberId`, in two queries for the
 * whole roster. Per-row lookups on a full deal exceed the 30s statement timeout.
 */
async function emailsByContactMemberId(
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uuids: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    const asEmail = normalizedEmail(id);
    if (asEmail) {
      out.set(id.toLowerCase(), asEmail);
      continue;
    }
    if (CONTACT_MEMBER_UUID_RE.test(id)) uuids.push(id);
  }
  const unique = [...new Set(uuids)];
  if (unique.length === 0) return out;

  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, unique));
  const foundUser = new Set<string>();
  for (const row of userRows) {
    const id = String(row.id).trim().toLowerCase();
    const em = normalizedEmail(row.email);
    if (!id || !em) continue;
    out.set(id, em);
    foundUser.add(id);
  }
  const missing = unique.filter((id) => !foundUser.has(id.toLowerCase()));
  if (missing.length === 0) return out;

  const contactRows = await db
    .select({ id: contact.id, email: contact.email })
    .from(contact)
    .where(inArray(contact.id, missing));
  for (const row of contactRows) {
    const id = String(row.id).trim().toLowerCase();
    const em = normalizedEmail(row.email);
    if (id && em && !out.has(id)) out.set(id, em);
  }
  return out;
}

export type ResolveInvestNowViewerContactResult = {
  lpInvestorRow: DealLpInvestorRow | undefined;
  contactMemberId: string;
};

/**
 * Contact key for `deal_investment.contact_id` / `deal_lp_investor.contact_member_id`
 * when a signed-in LP starts or continues Invest Now.
 *
 * Self-service onboarding does not require the sponsor to add the investor first:
 * the portal user's id (or a contact row matching their email) is used and the
 * LP roster row is created on the first commitment save.
 */
export async function resolveInvestNowViewerContactOnDeal(params: {
  dealId: string;
  viewerEmailNorm: string;
  viewerUserId: string;
}): Promise<ResolveInvestNowViewerContactResult> {
  const dealId = String(params.dealId ?? "").trim();
  const email = String(params.viewerEmailNorm ?? "").trim().toLowerCase();
  const viewerUserId = String(params.viewerUserId ?? "").trim();

  const matchRows = await db
    .select()
    .from(dealLpInvestor)
    .where(eq(dealLpInvestor.dealId, dealId));
  const lpEmails = await emailsByContactMemberId(
    matchRows.map((row) => row.contactMemberId),
  );

  let lpInvestorRow: DealLpInvestorRow | undefined;
  for (const row of matchRows) {
    const key = String(row.contactMemberId ?? "").trim().toLowerCase();
    const em = key ? lpEmails.get(key) : undefined;
    if (email && em === email) {
      lpInvestorRow = row;
      break;
    }
  }

  if (lpInvestorRow?.contactMemberId) {
    return {
      lpInvestorRow,
      contactMemberId: String(lpInvestorRow.contactMemberId).trim(),
    };
  }

  let contactMemberId = "";
  const preferred = new Set<string>();
  if (viewerUserId) preferred.add(viewerUserId);

  const byEmail =
    email.includes("@")
      ? await db
          .select({ id: contact.id })
          .from(contact)
          .where(sql`lower(trim(${contact.email})) = ${email}`)
      : [];

  for (const row of byEmail) {
    const cid = String(row.id ?? "").trim();
    if (cid) preferred.add(cid);
  }

  if (viewerUserId) {
    const memberRows = await db
      .select({ contactMemberId: dealMember.contactMemberId })
      .from(dealMember)
      .where(eq(dealMember.dealId, dealId));
    const memberEmails = await emailsByContactMemberId(
      memberRows.map((row) => row.contactMemberId),
    );

    for (const row of memberRows) {
      const cid = String(row.contactMemberId ?? "").trim();
      if (!cid) continue;
      if (preferred.has(cid)) {
        contactMemberId = cid;
        break;
      }
    }

    if (!contactMemberId && email.includes("@")) {
      for (const row of memberRows) {
        const cid = String(row.contactMemberId ?? "").trim();
        if (!cid) continue;
        const em = memberEmails.get(cid.toLowerCase());
        if (em === email) {
          contactMemberId = cid;
          break;
        }
      }
    }
  }

  if (!contactMemberId && viewerUserId && email.includes("@")) {
    const referredContactId = await findInviteAttributedContactId({
      viewerUserId,
      emailNorm: email,
    });
    if (referredContactId) contactMemberId = referredContactId;
  }

  if (!contactMemberId && viewerUserId) {
    contactMemberId = viewerUserId;
  }
  if (!contactMemberId && byEmail.length > 0) {
    const cid = String(byEmail[0]?.id ?? "").trim();
    if (cid) contactMemberId = cid;
  }

  return { lpInvestorRow, contactMemberId };
}
