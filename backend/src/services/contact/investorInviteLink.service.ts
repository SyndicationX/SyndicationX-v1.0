import { eq, sql } from "drizzle-orm";
import { INVESTOR } from "../../constants/roles.js";
import {
  isDealStageDraft,
  normalizeDealStageCanonical,
} from "../../constants/deal-lifecycle/deal-stage.js";
import { db } from "../../database/db.js";
import { users } from "../../schema/auth.schema/signin.js";
import { contact } from "../../schema/contact.schema.js";
import { dealLpInvestor } from "../../schema/deal.schema/deal-lp-investor.schema.js";
import {
  decryptInvestorInviteRef,
  encryptInvestorInviteRef,
} from "../../utils/investorInviteRefCrypto.js";
import { parseUsPhoneToE164 } from "../../utils/usPhone.js";
import { invalidateContactDirectoryCache } from "../cache/listReadCache.js";
import { queueGhlContactRowSync } from "../ghl/ghlContactSync.service.js";
import { resolveOrganizationIdForUserId } from "../org/orgResolution.service.js";
import { reconcileAssigningDealUsersForDeal } from "../deal/assigningDealUser.service.js";
import { getAddDealFormById } from "../deal/dealForm.service.js";
import { isPortalUserDealSponsorOnDeal } from "../deal/dealMemberScope.service.js";
import {
  buildContactFullName,
  getUserDisplayNameById,
} from "./contact.service.js";

/** Each portal user gets their own link, so signups can be traced back to the sharer. */
export type InvestorInviteLink = {
  ref: string;
  inviteUrl: string;
  dealId?: string;
};

export type InvestorInviteReferrer = {
  sponsorUserId: string;
  organizationId: string | null;
  dealId: string | null;
};

export type BuildDealInvestorInviteLinkResult =
  | { ok: true; link: InvestorInviteLink }
  | { ok: false; status: 403 | 404; message: string };

function frontendOrigin(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() || process.env.BASE_URL?.trim() || "";
  return raw.replace(/\/$/, "");
}

function requireFrontendOrigin(): string {
  const origin = frontendOrigin();
  if (!origin) {
    throw new Error(
      "FRONTEND_URL (or BASE_URL) is not configured on the server; cannot build the invite link.",
    );
  }
  return origin;
}

async function assertSharerCanInvite(userId: string): Promise<boolean> {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
  const [row] = await db
    .select({ role: users.role, userStatus: users.userStatus })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  if (!row) return false;
  if (String(row.role ?? "").trim() === INVESTOR) return false;
  if (String(row.userStatus ?? "").trim().toLowerCase() === "suspended") {
    return false;
  }
  return true;
}

/**
 * Builds this user's investor signup link (`/signup?ref=…`). Investors cannot
 * invite other investors, so they get no link.
 */
export async function buildInvestorInviteLinkForUser(
  userId: string,
): Promise<InvestorInviteLink | null> {
  const uid = String(userId ?? "").trim();
  if (!(await assertSharerCanInvite(uid))) return null;

  const origin = requireFrontendOrigin();
  const ref = encryptInvestorInviteRef(uid);
  return {
    ref,
    inviteUrl: `${origin}/signup?ref=${encodeURIComponent(ref)}`,
  };
}

/**
 * Deal-scoped invite unique to this lead / admin / co-sponsor. Investors sign
 * up or sign in with it; the resulting contact stores org, deal, and sponsor.
 */
export async function buildInvestorInviteLinkForDeal(
  userId: string,
  dealId: string,
): Promise<BuildDealInvestorInviteLinkResult> {
  const uid = String(userId ?? "").trim();
  const did = String(dealId ?? "").trim();
  if (!uid || !did) {
    return { ok: false, status: 404, message: "Deal not found." };
  }
  if (!(await assertSharerCanInvite(uid))) {
    return {
      ok: false,
      status: 403,
      message: "This account cannot share an investor invite link.",
    };
  }

  const deal = await getAddDealFormById(did);
  if (!deal) {
    return { ok: false, status: 404, message: "Deal not found." };
  }
  if (deal.archived) {
    return {
      ok: false,
      status: 403,
      message: "Invite links are not available for archived deals.",
    };
  }
  const stage = normalizeDealStageCanonical(deal.dealStage);
  if (isDealStageDraft(deal.dealStage) || stage === "liquidated") {
    return {
      ok: false,
      status: 403,
      message:
        "Change the deal stage before sharing an investor invite link.",
    };
  }
  if (!(await isPortalUserDealSponsorOnDeal(did, uid))) {
    return {
      ok: false,
      status: 403,
      message:
        "Only the lead sponsor, admin sponsor, or co-sponsor can share this deal’s invite link.",
    };
  }

  const origin = requireFrontendOrigin();
  const ref = encryptInvestorInviteRef(uid, did);
  const next = `/deals/${encodeURIComponent(did)}`;
  return {
    ok: true,
    link: {
      ref,
      dealId: did,
      inviteUrl: `${origin}/signup?ref=${encodeURIComponent(ref)}&next=${encodeURIComponent(next)}`,
    },
  };
}

/** Resolves a `ref` query value back to the sharer, dropping stale or suspended users. */
export async function resolveInvestorInviteReferrer(
  rawRef: string | null | undefined,
): Promise<InvestorInviteReferrer | null> {
  const raw = String(rawRef ?? "").trim();
  if (!raw) return null;

  let decoded = null as ReturnType<typeof decryptInvestorInviteRef>;
  try {
    decoded = decryptInvestorInviteRef(decodeURIComponent(raw));
  } catch {
    decoded = decryptInvestorInviteRef(raw);
  }
  if (!decoded?.sponsorUserId) return null;

  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      userStatus: users.userStatus,
    })
    .from(users)
    .where(eq(users.id, decoded.sponsorUserId))
    .limit(1);
  if (!row?.id) return null;
  if (String(row.role ?? "").trim() === INVESTOR) return null;
  if (String(row.userStatus ?? "").trim().toLowerCase() === "suspended") {
    return null;
  }

  const sponsorUserId = String(row.id).trim();
  const sponsorOrgId =
    (await resolveOrganizationIdForUserId(sponsorUserId)) ?? null;

  const tokenDealId = String(decoded.dealId ?? "").trim();
  if (!tokenDealId) {
    return { sponsorUserId, organizationId: sponsorOrgId, dealId: null };
  }

  const deal = await getAddDealFormById(tokenDealId);
  if (
    !deal ||
    deal.archived ||
    !(await isPortalUserDealSponsorOnDeal(tokenDealId, sponsorUserId))
  ) {
    return { sponsorUserId, organizationId: sponsorOrgId, dealId: null };
  }

  const dealOrg = String(deal.organizationId ?? "").trim() || null;
  return {
    sponsorUserId,
    organizationId: dealOrg ?? sponsorOrgId,
    dealId: tokenDealId,
  };
}

async function ensureReferredInvestorOnDeal(params: {
  dealId: string;
  sponsorUserId: string;
  contactId: string;
  investorUserId: string;
  emailNorm: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const dealId = String(params.dealId ?? "").trim();
  const contactId = String(params.contactId ?? "").trim();
  const investorUserId = String(params.investorUserId ?? "").trim();
  if (!dealId || !contactId) return;

  const emailNorm = String(params.emailNorm ?? "").trim().toLowerCase();
  const investorName =
    [params.firstName, params.lastName]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ") || emailNorm;

  await db
    .insert(dealLpInvestor)
    .values({
      dealId,
      investorName,
      addedBy: params.sponsorUserId || null,
      contactMemberId: contactId,
      email: emailNorm.includes("@") ? emailNorm : null,
      role: "LP Investor",
      profileId: "",
      investorClass: "",
      sendInvitationMail: "no",
      isDraft: false,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [dealLpInvestor.dealId, dealLpInvestor.contactMemberId],
    });

  if (investorUserId) {
    await reconcileAssigningDealUsersForDeal(dealId, investorUserId);
  }
}

/**
 * CRM row for an investor who signed up through a sponsor's invite link: owned by
 * that sponsor in their company, the same as a contact they had added by hand.
 */
export async function ensureReferredInvestorContact(params: {
  referrer: InvestorInviteReferrer;
  emailNorm: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<string | null> {
  const { sponsorUserId, organizationId, dealId } = params.referrer;
  const emailNorm = String(params.emailNorm ?? "").trim().toLowerCase();
  if (!sponsorUserId || !emailNorm.includes("@")) return null;

  const emailMatch = sql`lower(trim(${contact.email})) = ${emailNorm}`;
  const matches = await db.select().from(contact).where(emailMatch);
  const orgId = String(organizationId ?? "").trim();
  const orgKey = orgId.toLowerCase();
  const inThisOrg = matches.find((row) => {
    const rowOrg = String(row.organizationId ?? "").trim().toLowerCase();
    if (orgKey && rowOrg === orgKey) return true;
    return !rowOrg && row.createdBy === sponsorUserId;
  });
  const unassigned = matches.find(
    (row) => row.platformAdminOnly || !String(row.organizationId ?? "").trim(),
  );
  const existing = inThisOrg ?? unassigned ?? null;

  const ownerName = (await getUserDisplayNameById(sponsorUserId)).trim();
  const dealToStore = String(dealId ?? "").trim() || null;

  if (!existing && matches.length > 0) {
    /** Already a CRM row for this email. Do not add a second contact for the same person. */
    return String(matches[0]?.id ?? "").trim() || null;
  }

  if (existing) {
    /** Keep an owner someone already assigned; only fill an empty Owners cell. */
    const keepOwners = (existing.owners ?? []).filter((o) => String(o).trim());
    const keepDeal = String(existing.referredByDealId ?? "").trim();
    const [updated] = await db
      .update(contact)
      .set({
        isPortalUser: true,
        ...(keepOwners.length === 0 && ownerName
          ? { owners: [ownerName] }
          : {}),
        ...(!keepDeal && dealToStore ? { referredByDealId: dealToStore } : {}),
      })
      .where(eq(contact.id, existing.id))
      .returning();
    if (updated) {
      invalidateContactDirectoryCache();
      queueGhlContactRowSync(updated);
    }
    return String(updated?.id ?? existing.id).trim() || null;
  }

  const firstName = String(params.firstName ?? "").trim() || "—";
  const lastName = String(params.lastName ?? "").trim() || "—";
  const phoneStored = parseUsPhoneToE164(String(params.phone ?? "").trim()) ?? "";

  const [inserted] = await db
    .insert(contact)
    .values({
      firstName,
      lastName,
      fullName: buildContactFullName(firstName, lastName),
      email: emailNorm,
      phone: phoneStored,
      note: "",
      tags: [],
      lists: [],
      owners: ownerName ? [ownerName] : [],
      status: "active",
      createdBy: sponsorUserId,
      organizationId,
      referredByDealId: dealToStore,
      isPortalUser: true,
      relationship506b: "NO",
      importSource: "invite_link",
    })
    .returning();

  if (inserted) {
    invalidateContactDirectoryCache();
    queueGhlContactRowSync(inserted);
  }
  return String(inserted?.id ?? "").trim() || null;
}

/**
 * Applies a sponsor invite `ref` after investor signup or sign-in: records the
 * referrer on the user, creates/updates the org contact (org + deal + sponsor),
 * and adds an LP roster row when the link was deal-scoped.
 */
export async function applyInvestorInviteAfterAuth(params: {
  inviteRef: string | null | undefined;
  userId: string;
  emailNorm: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: string;
}): Promise<{ applied: boolean; contactId: string | null }> {
  const userId = String(params.userId ?? "").trim();
  const role = String(params.role ?? "").trim();
  if (!userId || role !== INVESTOR) {
    return { applied: false, contactId: null };
  }

  const referrer = await resolveInvestorInviteReferrer(params.inviteRef).catch(
    (e) => {
      console.error("resolveInvestorInviteReferrer:", e);
      return null;
    },
  );
  if (!referrer) return { applied: false, contactId: null };

  try {
    const [existing] = await db
      .select({ referredByUserId: users.referredByUserId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!String(existing?.referredByUserId ?? "").trim()) {
      await db
        .update(users)
        .set({ referredByUserId: referrer.sponsorUserId })
        .where(eq(users.id, userId));
    }
  } catch (e) {
    console.error("record investor invite referrer:", e);
  }

  let contactId: string | null = null;
  try {
    contactId = await ensureReferredInvestorContact({
      referrer,
      emailNorm: params.emailNorm,
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone,
    });
  } catch (e) {
    console.error("ensureReferredInvestorContact:", e);
  }

  if (referrer.dealId && contactId) {
    try {
      await ensureReferredInvestorOnDeal({
        dealId: referrer.dealId,
        sponsorUserId: referrer.sponsorUserId,
        contactId,
        investorUserId: userId,
        emailNorm: params.emailNorm,
        firstName: params.firstName,
        lastName: params.lastName,
      });
    } catch (e) {
      console.error("ensureReferredInvestorOnDeal:", e);
    }
  }

  return { applied: true, contactId };
}

/**
 * True when this investor signed up through someone's invite link
 * (`users.referred_by_user_id`). Those accounts do not choose Platform Contacts
 * visibility — they are already on the referrer's org contacts list.
 */
export async function investorSignedUpViaInviteLink(
  userId: string,
): Promise<boolean> {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
  const [row] = await db
    .select({ referredByUserId: users.referredByUserId })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  return Boolean(String(row?.referredByUserId ?? "").trim());
}
