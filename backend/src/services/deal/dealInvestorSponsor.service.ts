import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  DEAL_PARTICIPANT,
  INVESTOR,
  ORG_DIRECTORY_MEMBER_ROLES,
} from "../../constants/roles.js";
import { listUserCompanyMemberships } from "../auth/userCompanyMembership.service.js";
import { resolveOrganizationIdForUserId } from "../org/orgResolution.service.js";
import {
  companies,
  dealInvestment,
  dealLpInvestor,
  dealMember,
  userCompanyMembership,
  users,
} from "../../schema/schema.js";
import {
  loadRosterAddedByMaps,
  mapContactIdsToCanonicalCommitmentKeys,
  resolveDealLeadSponsorFallback,
  resolveInvestorRowAddedByUserId,
} from "./dealInvestment.service.js";
import {
  DealLeadSponsorValidationError,
  saveDealMemberRoleForDeal,
} from "./dealMember.service.js";
import { isDealRosterEligibilityError } from "../user/portalUserRosterGuard.service.js";
import { sendInvestorSponsorUpdatedEmails } from "./investorSponsorUpdatedEmail.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STAFF_ROLES = new Set<string>(ORG_DIRECTORY_MEMBER_ROLES);

export type InvestorSponsorChoice = {
  userId: string;
  displayName: string;
  email: string;
};

export type InvestorSponsorOptions = {
  companyName: string;
  currentSponsorUserId: string;
  sponsors: InvestorSponsorChoice[];
};

type SponsorUpdateResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

type StaffRow = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  userStatus: string | null;
};

function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function contactKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

function personName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = `${String(firstName ?? "").trim()} ${String(lastName ?? "").trim()}`.trim();
  if (name) return name;
  const mail = String(email ?? "").trim();
  return mail || "Sponsor";
}

function isActiveStaff(row: StaffRow): boolean {
  const status = String(row.userStatus ?? "").trim().toLowerCase();
  if (status && status !== "active") return false;
  const role = String(row.role ?? "").trim();
  if (!role || role === INVESTOR || role === DEAL_PARTICIPANT) return false;
  return STAFF_ROLES.has(role);
}

/** Labels the General Partners tab already recognizes. */
const STORED_SPONSOR_ROLE: Record<string, string> = {
  "lead sponsor": "Lead Sponsor",
  "admin sponsor": "admin sponsor",
  "co sponsor": "Co-sponsor",
};

/** Lead Sponsor, Admin sponsor, or Co-sponsor, in the form stored on the roster. */
export function canonicalSponsorRosterRole(
  role: string | null | undefined,
): string | null {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return STORED_SPONSOR_ROLE[normalized] ?? null;
}

function sponsorRoleStrength(role: string): number {
  if (role === "Lead Sponsor") return 3;
  if (role === "admin sponsor") return 2;
  if (role === "Co-sponsor") return 1;
  return 0;
}

/**
 * Role to give a sponsor who is not already on General Partners.
 * A second Lead Sponsor is not created; the deal already has one.
 * When the previous sponsor is the Lead Sponsor, the new person is added as
 * an Admin sponsor so their Investors committed total has a roster row.
 * An Admin sponsor is preferred over a Co-sponsor row for the same person.
 */
export function sponsorRoleForNewGeneralPartner(input: {
  previousRoles: (string | null | undefined)[];
  nextAlreadyOnRoster: boolean;
}): string | null {
  if (input.nextAlreadyOnRoster) return null;
  let best: string | null = null;
  let strength = 0;
  for (const raw of input.previousRoles) {
    const role = canonicalSponsorRosterRole(raw);
    if (!role) continue;
    const nextStrength = sponsorRoleStrength(role);
    if (nextStrength > strength) {
      strength = nextStrength;
      best = role;
    }
  }
  if (!best) return null;
  if (best === "Lead Sponsor") return "admin sponsor";
  return best;
}

function toChoice(row: StaffRow): InvestorSponsorChoice {
  const email = String(row.email ?? "").trim();
  return {
    userId: String(row.id),
    displayName: personName(row.firstName, row.lastName, email),
    email,
  };
}

async function sponsorCompany(
  sponsorUserId: string,
): Promise<{ ids: string[]; names: string[] }> {
  const memberships = await listUserCompanyMemberships(sponsorUserId);
  if (memberships.length > 0) {
    const ids: string[] = [];
    const names: string[] = [];
    for (const membership of memberships) {
      const id = String(membership.companyId ?? "").trim();
      if (!looksLikeUuid(id) || ids.includes(id)) continue;
      ids.push(id);
      const name = String(membership.companyName ?? "").trim();
      if (name) names.push(name);
    }
    return { ids, names };
  }
  const orgId = String(
    (await resolveOrganizationIdForUserId(sponsorUserId)) ?? "",
  ).trim();
  if (!looksLikeUuid(orgId)) return { ids: [], names: [] };
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, orgId))
    .limit(1);
  const name = String(company?.name ?? "").trim();
  return { ids: [orgId], names: name ? [name] : [] };
}

/** True when both users belong to at least one of the same companies. */
export async function sponsorUsersShareCompany(
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const a = String(userIdA ?? "").trim();
  const b = String(userIdB ?? "").trim();
  if (!looksLikeUuid(a) || !looksLikeUuid(b)) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const [companyA, companyB] = await Promise.all([
    sponsorCompany(a),
    sponsorCompany(b),
  ]);
  const ids = new Set(companyA.ids.map((id) => id.toLowerCase()));
  return companyB.ids.some((id) => ids.has(id.toLowerCase()));
}

async function investorContactSeeds(
  dealId: string,
  rowId: string,
): Promise<string[]> {
  const seeds: string[] = [];
  const [investment] = await db
    .select({ contactId: dealInvestment.contactId })
    .from(dealInvestment)
    .where(and(eq(dealInvestment.dealId, dealId), eq(dealInvestment.id, rowId)))
    .limit(1);
  if (investment?.contactId) seeds.push(String(investment.contactId));

  const [lp] = await db
    .select({ contactMemberId: dealLpInvestor.contactMemberId })
    .from(dealLpInvestor)
    .where(and(eq(dealLpInvestor.dealId, dealId), eq(dealLpInvestor.id, rowId)))
    .limit(1);
  if (lp?.contactMemberId) seeds.push(String(lp.contactMemberId));

  const [member] = await db
    .select({ contactMemberId: dealMember.contactMemberId })
    .from(dealMember)
    .where(and(eq(dealMember.dealId, dealId), eq(dealMember.id, rowId)))
    .limit(1);
  if (member?.contactMemberId) seeds.push(String(member.contactMemberId));
  return [...new Set(seeds.map((id) => id.trim()).filter(Boolean))];
}

async function currentSponsorUserId(
  dealId: string,
  rowId: string,
  contactIds: string[],
): Promise<string> {
  const maps = await loadRosterAddedByMaps(dealId);
  const rawToCanonical = await mapContactIdsToCanonicalCommitmentKeys([
    ...maps.byContactKey.keys(),
    ...contactIds,
    rowId,
  ]);
  for (const contactId of contactIds) {
    const resolved = resolveInvestorRowAddedByUserId(
      { id: rowId, contactId },
      maps.byContactKey,
      maps.byLpRowId,
      rawToCanonical,
      maps.lpContactKeys,
    );
    const id = String(resolved ?? "").trim();
    if (looksLikeUuid(id)) return id;
  }
  const fallback = await resolveDealLeadSponsorFallback(dealId);
  const leadId = String(fallback.userId ?? "").trim();
  return looksLikeUuid(leadId) ? leadId : "";
}

async function listCompanyStaff(companyIds: string[]): Promise<StaffRow[]> {
  if (companyIds.length === 0) return [];
  const byOrg = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      userStatus: users.userStatus,
    })
    .from(users)
    .where(inArray(users.organizationId, companyIds));

  let byMembership: StaffRow[] = [];
  try {
    byMembership = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        userStatus: users.userStatus,
      })
      .from(users)
      .innerJoin(
        userCompanyMembership,
        eq(userCompanyMembership.userId, users.id),
      )
      .where(inArray(userCompanyMembership.companyId, companyIds));
  } catch (err) {
    let cur: unknown = err;
    let missing = false;
    for (let i = 0; i < 4; i += 1) {
      if (!cur || typeof cur !== "object") break;
      const e = cur as { code?: string; message?: string; cause?: unknown };
      const msg = String(e.message ?? "");
      if (
        e.code === "42P01" ||
        msg.includes('relation "user_company_membership" does not exist')
      ) {
        missing = true;
        break;
      }
      cur = e.cause;
    }
    if (!missing) throw err;
  }

  const seen = new Set<string>();
  const staff: StaffRow[] = [];
  for (const row of [...byMembership, ...byOrg]) {
    const id = String(row.id ?? "").trim().toLowerCase();
    if (!id || seen.has(id) || !isActiveStaff(row)) continue;
    seen.add(id);
    staff.push(row);
  }
  return staff;
}

async function loadInvestorSponsorContext(
  dealId: string,
  rowId: string,
): Promise<
  | {
      ok: true;
      companyName: string;
      currentSponsorUserId: string;
      sponsors: InvestorSponsorChoice[];
      contactIds: string[];
    }
  | { ok: false; status: number; message: string }
> {
  if (!looksLikeUuid(dealId) || !looksLikeUuid(rowId)) {
    return { ok: false, status: 400, message: "Invalid investor." };
  }
  const contactIds = await investorContactSeeds(dealId, rowId);
  if (contactIds.length === 0) {
    return { ok: false, status: 404, message: "Investor not found on this deal." };
  }
  const sponsorUserId = await currentSponsorUserId(dealId, rowId, contactIds);
  if (!sponsorUserId) {
    return {
      ok: false,
      status: 400,
      message: "This investor does not have a sponsor to update.",
    };
  }
  const company = await sponsorCompany(sponsorUserId);
  if (company.ids.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "This investor's sponsor is not linked to a company.",
    };
  }
  const staff = await listCompanyStaff(company.ids);
  const sponsors = staff
    .map(toChoice)
    .sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      }),
    );
  if (!sponsors.some((s) => s.userId.toLowerCase() === sponsorUserId.toLowerCase())) {
    const [current] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        userStatus: users.userStatus,
      })
      .from(users)
      .where(eq(users.id, sponsorUserId))
      .limit(1);
    if (current) sponsors.unshift(toChoice(current));
  }
  return {
    ok: true,
    companyName: company.names.join(", "),
    currentSponsorUserId: sponsorUserId,
    sponsors,
    contactIds,
  };
}

/** People in the investor's current sponsor company that a lead sponsor may assign. */
export async function listInvestorSponsorOptions(
  dealId: string,
  rowId: string,
): Promise<
  { ok: true; options: InvestorSponsorOptions } | { ok: false; status: number; message: string }
> {
  const ctx = await loadInvestorSponsorContext(dealId, rowId);
  if (!ctx.ok) return ctx;
  return {
    ok: true,
    options: {
      companyName: ctx.companyName,
      currentSponsorUserId: ctx.currentSponsorUserId,
      sponsors: ctx.sponsors,
    },
  };
}

/**
 * Point this investor's Sponsor name at another person in the same sponsor company.
 * Updates `deal_lp_investor.added_by` and the matching investor `deal_member.added_by`.
 * When that person is not already on General Partners, they are added with the
 * previous sponsor's role (Admin sponsor stays Admin sponsor, Co-sponsor stays
 * Co-sponsor).
 */
export async function updateInvestorSponsor(params: {
  dealId: string;
  rowId: string;
  sponsorUserId: string;
  actorUserId?: string;
}): Promise<SponsorUpdateResult> {
  const nextId = String(params.sponsorUserId ?? "").trim();
  if (!looksLikeUuid(nextId)) {
    return { ok: false, status: 400, message: "Choose a sponsor." };
  }
  const ctx = await loadInvestorSponsorContext(params.dealId, params.rowId);
  if (!ctx.ok) return ctx;
  const allowed = ctx.sponsors.some(
    (s) => s.userId.toLowerCase() === nextId.toLowerCase(),
  );
  if (!allowed) {
    return {
      ok: false,
      status: 400,
      message: "Choose a sponsor from this investor's sponsor company.",
    };
  }
  if (ctx.currentSponsorUserId.toLowerCase() === nextId.toLowerCase()) {
    return { ok: true };
  }

  const [lpRows, memberRows, investmentRows] = await Promise.all([
    db
      .select({
        id: dealLpInvestor.id,
        contactMemberId: dealLpInvestor.contactMemberId,
        investorName: dealLpInvestor.investorName,
      })
      .from(dealLpInvestor)
      .where(eq(dealLpInvestor.dealId, params.dealId)),
    db
      .select({
        id: dealMember.id,
        contactMemberId: dealMember.contactMemberId,
        dealMemberRole: dealMember.dealMemberRole,
        isDraft: dealMember.isDraft,
      })
      .from(dealMember)
      .where(eq(dealMember.dealId, params.dealId)),
    db
      .select({
        contactId: dealInvestment.contactId,
        investorRole: dealInvestment.investor_role,
        isDraft: dealInvestment.isDraft,
      })
      .from(dealInvestment)
      .where(eq(dealInvestment.dealId, params.dealId)),
  ]);

  const rawIds = [
    ...ctx.contactIds,
    ctx.currentSponsorUserId,
    nextId,
    ...lpRows.map((row) => row.contactMemberId),
    ...memberRows.map((row) => row.contactMemberId),
    ...investmentRows.map((row) => row.contactId),
  ];
  const canonical = await mapContactIdsToCanonicalCommitmentKeys(rawIds);
  const seedCanons = new Set(
    ctx.contactIds.map((id) => {
      const key = contactKey(id);
      return canonical.get(key) ?? `id:${key}`;
    }),
  );
  const seedKeys = new Set(ctx.contactIds.map((id) => contactKey(id)));
  const samePerson = (raw: string | null | undefined) => {
    const key = contactKey(raw);
    if (!key) return false;
    if (seedKeys.has(key)) return true;
    return seedCanons.has(canonical.get(key) ?? `id:${key}`);
  };

  const rowKey = contactKey(params.rowId);
  const lpIds = lpRows
    .filter(
      (row) =>
        samePerson(row.contactMemberId) || contactKey(row.id) === rowKey,
    )
    .map((row) => row.id);
  const memberIds = memberRows
    .filter(
      (row) =>
        samePerson(row.contactMemberId) || contactKey(row.id) === rowKey,
    )
    .map((row) => row.id);

  if (lpIds.length === 0 && memberIds.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "This investor has no sponsor record to update.",
    };
  }

  const personCanon = (raw: string | null | undefined) => {
    const key = contactKey(raw);
    if (!key) return "";
    return canonical.get(key) ?? `id:${key}`;
  };
  const previousCanon = personCanon(ctx.currentSponsorUserId);
  const nextCanon = personCanon(nextId);
  const memberRolesFor = (canon: string) => {
    if (!canon) return [];
    return memberRows
      .filter(
        (row) => !row.isDraft && personCanon(row.contactMemberId) === canon,
      )
      .map((row) => row.dealMemberRole);
  };
  const investmentRolesFor = (canon: string) => {
    if (!canon) return [];
    return investmentRows
      .filter((row) => !row.isDraft && personCanon(row.contactId) === canon)
      .map((row) => row.investorRole);
  };
  const roleToAssign = sponsorRoleForNewGeneralPartner({
    previousRoles: [
      ...memberRolesFor(previousCanon),
      ...investmentRolesFor(previousCanon),
    ],
    nextAlreadyOnRoster: memberRolesFor(nextCanon).some(
      (role) => canonicalSponsorRosterRole(role) != null,
    ),
  });
  if (roleToAssign) {
    const actor = String(params.actorUserId ?? "").trim();
    try {
      await saveDealMemberRoleForDeal(params.dealId, {
        contactMemberId: nextId,
        dealMemberRole: roleToAssign,
        sendInvitationMail: "no",
        addedByUserId: looksLikeUuid(actor) ? actor : nextId,
      });
    } catch (err) {
      if (
        err instanceof DealLeadSponsorValidationError ||
        isDealRosterEligibilityError(err)
      ) {
        return { ok: false, status: 400, message: err.message };
      }
      throw err;
    }
  }

  const now = new Date();
  if (lpIds.length > 0) {
    await db
      .update(dealLpInvestor)
      .set({ addedBy: nextId, updatedAt: now })
      .where(
        and(
          eq(dealLpInvestor.dealId, params.dealId),
          inArray(dealLpInvestor.id, lpIds),
        ),
      );
  }
  if (memberIds.length > 0) {
    await db
      .update(dealMember)
      .set({ addedBy: nextId, updatedAt: now })
      .where(
        and(eq(dealMember.dealId, params.dealId), inArray(dealMember.id, memberIds)),
      );
  }

  const sponsorChoice = ctx.sponsors.find(
    (sponsor) => sponsor.userId.toLowerCase() === nextId.toLowerCase(),
  );
  const investorDisplayName =
    lpRows
      .find(
        (row) =>
          samePerson(row.contactMemberId) &&
          String(row.investorName ?? "").trim(),
      )
      ?.investorName?.trim() || "";
  try {
    await sendInvestorSponsorUpdatedEmails({
      dealId: params.dealId,
      investorContactIds: ctx.contactIds,
      investorDisplayName,
      sponsorDisplayName: sponsorChoice?.displayName || "",
      sponsorEmail: sponsorChoice?.email || "",
    });
  } catch (error: unknown) {
    console.warn("updateInvestorSponsor email:", error);
  }
  return { ok: true };
}
