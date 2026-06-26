/**
 * LP investing-mode nav, session flags, and deal allowlists from:
 * - `deal_lp_investor` only (contact email and/or denormalized `deal_lp_investor.email`).
 */
import { and, inArray, ne, or, sql } from "drizzle-orm";
import {
  isInvestorDashboardOpportunityOffering,
} from "../../constants/deal-lifecycle/deal-status-rules.js";
import { addDealForm } from "../../schema/deal.schema/add-deal-form.schema.js";
import {
  DEAL_PARTICIPANT,
  isCompanyAdminRole,
  isInvestorPortalRole,
  isPlatformAdminRole,
} from "../../constants/roles.js";
import { db, pool } from "../../database/db.js";
import { dealLpInvestor } from "../../schema/deal.schema/deal-lp-investor.schema.js";
import { contact } from "../../schema/schema.js";
import { listDealIdsAssignedToUser } from "../deal/assigningDealUser.service.js";

/** Stored `deal_lp_investor.role` values treated as LP Investor for nav + deal scope. */
export function isLpInvestorRoleInLpTable(role: string | null | undefined): boolean {
  const t = String(role ?? "").trim().toLowerCase();
  if (!t) return false;
  return (
    t === "lp investor" ||
    t === "lp investors" ||
    t === "lp_investors" ||
    t === "lp_investor"
  );
}

/**
 * Distinct `deal_id`s where this email matches the LP row via `contact.email` and/or
 * denormalized `deal_lp_investor.email` (e.g. invite flow sets the column before contact is updated).
 */
async function listDealIdsFromLpInvestorTableForEmail(
  emailNorm: string,
): Promise<string[]> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return [];

  const [fromContact, fromLpRowEmail] = await Promise.all([
    db
      .selectDistinct({ dealId: dealLpInvestor.dealId })
      .from(dealLpInvestor)
      .innerJoin(
        contact,
        sql`${contact.id}::text = trim(both from ${dealLpInvestor.contactMemberId})`,
      )
      .where(
        sql`(nullif(trim(${contact.email}), '') IS NOT NULL AND lower(trim(${contact.email})) = ${e})`,
      ),
    db
      .selectDistinct({ dealId: dealLpInvestor.dealId })
      .from(dealLpInvestor)
      .where(
        sql`nullif(trim(${dealLpInvestor.email}), '') IS NOT NULL AND lower(trim(${dealLpInvestor.email})) = ${e}`,
      ),
  ]);

  return [
    ...new Set(
      [...fromContact, ...fromLpRowEmail]
        .map((r) => String(r.dealId ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Deals where this email appears on `deal_member`, was added to the roster by `added_by`,
 * and that adder is a Lead / Admin / Co-sponsor on the same `deal_member` set.
 */
async function listDealIdsFromSponsorInvitedDealMemberForEmail(
  emailNorm: string,
): Promise<string[]> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return [];
  const res = await pool.query<{ deal_id: string }>(
    `SELECT DISTINCT dm_investor.deal_id::text AS deal_id
     FROM deal_member dm_investor
     INNER JOIN users viewer_u ON lower(trim(viewer_u.email)) = $1
     INNER JOIN users adder_u ON adder_u.id = dm_investor.added_by
     INNER JOIN deal_member dm_sponsor ON
       dm_sponsor.deal_id = dm_investor.deal_id
       AND lower(trim(dm_sponsor.deal_member_role)) IN (
         'lead sponsor', 'admin sponsor', 'co-sponsor', 'co sponsor'
       )
       AND (
         trim(dm_sponsor.contact_member_id) = adder_u.id::text
         OR EXISTS (
           SELECT 1 FROM contact c
           WHERE c.id::text = trim(both from dm_sponsor.contact_member_id)
             AND lower(trim(c.email)) = lower(trim(adder_u.email))
         )
       )
     WHERE dm_investor.added_by IS NOT NULL
       AND (
         trim(dm_investor.contact_member_id) = viewer_u.id::text
         OR EXISTS (
           SELECT 1 FROM contact c2
           WHERE c2.id::text = trim(both from dm_investor.contact_member_id)
             AND lower(trim(c2.email)) = $1
         )
       )`,
    [e],
  );
  return [
    ...new Set(
      res.rows.map((r) => String(r.deal_id ?? "").trim()).filter(Boolean),
    ),
  ];
}

/**
 * Deals with a `deal_investment` row for this person: `contact_id` = portal `users.id`,
 * or a CRM `contact` id whose email matches. Includes $0 commitment (sponsor-added
 * rows before a commitment is entered). This path is required because LP–role
 * lines skip `deal_member` and may not yet match `deal_lp_investor` email joins.
 */
async function listDealIdsFromDealInvestmentForEmail(
  emailNorm: string,
): Promise<string[]> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return [];
  const res = await pool.query<{ deal_id: string }>(
    `SELECT DISTINCT di.deal_id::text AS deal_id
     FROM deal_investment di
     INNER JOIN users viewer_u ON lower(trim(viewer_u.email)) = $1
     WHERE nullif(trim(di.contact_id), '') IS NOT NULL
       AND (
         trim(both from di.contact_id) = viewer_u.id::text
         OR EXISTS (
           SELECT 1 FROM contact c
           WHERE c.id::text = trim(both from di.contact_id)
             AND nullif(trim(c.email), '') IS NOT NULL
             AND lower(trim(c.email)) = $1
         )
       )`,
    [e],
  );
  return [
    ...new Set(
      res.rows.map((r) => String(r.deal_id ?? "").trim()).filter(Boolean),
    ),
  ];
}

/**
 * True when this email appears on `deal_member` as a sponsor role.
 * Sponsor participants should stay in syndication shell (not forced investing-only LP nav).
 */
async function hasSponsorDealMemberRoleForEmail(
  emailNorm: string,
): Promise<boolean> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return false;
  const res = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM deal_member dm
     INNER JOIN users u ON lower(trim(u.email)) = $1
     WHERE lower(trim(dm.deal_member_role)) IN (
       'lead sponsor', 'admin sponsor', 'co-sponsor', 'co sponsor'
     )
       AND (
         trim(dm.contact_member_id) = u.id::text
         OR EXISTS (
           SELECT 1 FROM contact c
           WHERE c.id::text = trim(both from dm.contact_member_id)
             AND lower(trim(c.email)) = $1
         )
       )
     LIMIT 1`,
    [e],
  );
  return res.rows.length > 0;
}

/** Distinct deal ids for LP investing portal from `deal_lp_investor` only. */
export async function listLpInvestorDealIdsForUserEmail(
  emailNorm: string,
): Promise<string[]> {
  return listDealIdsFromLpInvestorTableForEmail(emailNorm);
}

/**
 * Distinct deal ids where this email appears on `deal_member` as Lead / Admin / Co-sponsor.
 */
export async function listDealIdsFromSponsorDealMemberForEmail(
  emailNorm: string,
): Promise<string[]> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return [];
  const res = await pool.query<{ deal_id: string }>(
    `SELECT DISTINCT dm.deal_id::text AS deal_id
     FROM deal_member dm
     INNER JOIN users u ON lower(trim(u.email)) = $1
     WHERE lower(trim(dm.deal_member_role)) IN (
       'lead sponsor', 'admin sponsor', 'co-sponsor', 'co sponsor'
     )
       AND (
         trim(dm.contact_member_id) = u.id::text
         OR EXISTS (
           SELECT 1 FROM contact c
           WHERE c.id::text = trim(both from dm.contact_member_id)
             AND lower(trim(c.email)) = $1
         )
       )`,
    [e],
  );
  return [
    ...new Set(
      res.rows
        .map((r) => String(r.deal_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Investor dashboard “Opportunities” — coming soon (preview) and open-for-investment
 * offerings visible on the portal (not draft / closed / past).
 */
export async function listInvestorVisibleComingSoonDealIds(): Promise<string[]> {
  const rows = await db
    .select({
      id: addDealForm.id,
      dealStage: addDealForm.dealStage,
      offeringStatus: addDealForm.offeringStatus,
    })
    .from(addDealForm)
    .where(ne(addDealForm.dealStage, "draft"));

  const out: string[] = [];
  for (const row of rows) {
    if (
      !isInvestorDashboardOpportunityOffering(
        row.dealStage,
        row.offeringStatus,
      )
    ) {
      continue;
    }
    const id = String(row.id ?? "").trim();
    if (id) out.push(id);
  }
  return out;
}

/**
 * Investing participant deals excluding dashboard “Opportunities” (coming soon /
 * open for investment) that are visible to any signed-in investor.
 */
export async function listDirectInvestingParticipantDealIdsForUser(params: {
  userId: string;
  emailNorm: string;
}): Promise<string[]> {
  const emailNorm = String(params.emailNorm ?? "").trim().toLowerCase();
  const userId = String(params.userId ?? "").trim();
  if (!emailNorm || !userId) return [];

  const [lp, sponsor, sponsorInvited, assigned, investment] =
    await Promise.all([
      listDealIdsFromLpInvestorTableForEmail(emailNorm),
      listDealIdsFromSponsorDealMemberForEmail(emailNorm),
      listDealIdsFromSponsorInvitedDealMemberForEmail(emailNorm),
      listDealIdsAssignedToUser(userId),
      listDealIdsFromDealInvestmentForEmail(emailNorm),
    ]);

  return [
    ...new Set([
      ...lp,
      ...sponsor,
      ...sponsorInvited,
      ...assigned,
      ...investment,
    ]),
  ];
}

export async function isDealInDirectInvestingParticipationForUser(
  dealId: string,
  params: { userId: string; emailNorm: string },
): Promise<boolean> {
  const id = String(dealId ?? "").trim();
  if (!id) return false;
  const ids = await listDirectInvestingParticipantDealIdsForUser(params);
  return ids.includes(id);
}

export async function isDealInInvestingParticipantListForUser(
  dealId: string,
  params: { userId: string; emailNorm: string },
): Promise<boolean> {
  const id = String(dealId ?? "").trim();
  if (!id) return false;
  const ids = await listInvestingParticipantDealIdsForUser(params);
  return ids.includes(id);
}

/**
 * Investing → Deals tab: deals the viewer participates in as LP, investor, roster
 * assignee, or sponsor (Lead / Admin / Co-sponsor on `deal_member`), plus visible
 * dashboard opportunity offerings (coming soon + open for investment).
 */
export async function listInvestingParticipantDealIdsForUser(params: {
  userId: string;
  emailNorm: string;
}): Promise<string[]> {
  const emailNorm = String(params.emailNorm ?? "").trim().toLowerCase();
  const userId = String(params.userId ?? "").trim();
  if (!emailNorm || !userId) return [];

  const [direct, comingSoon] = await Promise.all([
    listDirectInvestingParticipantDealIdsForUser({ userId, emailNorm }),
    listInvestorVisibleComingSoonDealIds(),
  ]);

  return [...new Set([...direct, ...comingSoon])];
}

/**
 * For each deal id, the `deal_lp_investor.role` for this portal user (contact email
 * and/or `deal_lp_investor.email` match). Used by GET /deals list when the viewer is LP email–scoped.
 */
export async function mapLpInvestorRoleDisplayByDealIdForUserEmail(
  emailNorm: string,
  dealIds: string[],
): Promise<Map<string, string>> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  const ids = [...new Set(dealIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (!e || !e.includes("@") || ids.length === 0) return new Map();

  const rows = await db
    .select({
      dealId: dealLpInvestor.dealId,
      role: dealLpInvestor.role,
    })
    .from(dealLpInvestor)
    .leftJoin(
      contact,
      sql`${contact.id}::text = trim(both from ${dealLpInvestor.contactMemberId})`,
    )
    .where(
      and(
        inArray(dealLpInvestor.dealId, ids),
        or(
          sql`(nullif(trim(${contact.email}), '') IS NOT NULL AND lower(trim(${contact.email})) = ${e})`,
          sql`nullif(trim(${dealLpInvestor.email}), '') IS NOT NULL AND lower(trim(${dealLpInvestor.email})) = ${e}`,
        ),
      ),
    );

  const map = new Map<string, string>();
  for (const r of rows) {
    const id = String(r.dealId ?? "").trim();
    const role = String(r.role ?? "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, role || "LP Investor");
  }
  return map;
}

/**
 * Session flags for sign-in / account: investing nav + deal id allowlist (see
 * {@link listLpInvestorDealIdsForUserEmail}).
 */
export async function resolveLpInvestorSessionFlags(emailNorm: string): Promise<{
  lp_investor_nav: boolean;
  lp_investor_deal_ids: string[];
  lp_investor_role_display: string | null;
}> {
  const dealIds = await listLpInvestorDealIdsForUserEmail(emailNorm);
  if (dealIds.length === 0) {
    return {
      lp_investor_nav: false,
      lp_investor_deal_ids: [],
      lp_investor_role_display: null,
    };
  }

  const lp_investor_role_display = "LP Investor";

  return {
    lp_investor_nav: true,
    lp_investor_deal_ids: dealIds,
    lp_investor_role_display,
  };
}

/**
 * Single writer for `is_lp_investor`, `lp_investor_nav`, and `lp_investor_deal_ids` on sign-in / account.
 * Platform/company admins keep syndication shell (`lp_investor_nav` false) even if listed as LP.
 */
export async function mergeLpInvestorFlagsIntoUserPayload(
  base: Record<string, unknown>,
  opts: { email: string | null | undefined; portalRole: string | null | undefined },
): Promise<Record<string, unknown>> {
  const emailNorm = String(opts.email ?? "").trim().toLowerCase();
  const portalRole = String(opts.portalRole ?? "").trim();
  const participantSponsorShell =
    portalRole === DEAL_PARTICIPANT &&
    (await hasSponsorDealMemberRoleForEmail(emailNorm));
  const adminShell =
    isPlatformAdminRole(portalRole) ||
    isCompanyAdminRole(portalRole) ||
    participantSponsorShell;

  if (!emailNorm || !emailNorm.includes("@")) {
    return {
      ...base,
      lp_investor_nav: false,
      lp_investor_deal_ids: [],
      lp_investor_role_display: null,
      is_lp_investor: false,
    };
  }

  if (isInvestorPortalRole(portalRole)) {
    const lp = await resolveLpInvestorSessionFlags(emailNorm);
    return {
      ...base,
      lp_investor_nav: true,
      lp_investor_deal_ids: lp.lp_investor_deal_ids,
      lp_investor_role_display: "Investor",
      is_lp_investor: true,
    };
  }

  const lp = await resolveLpInvestorSessionFlags(emailNorm);
  const lpNav = lp.lp_investor_nav && !adminShell;
  return {
    ...base,
    lp_investor_nav: lpNav,
    lp_investor_deal_ids: lpNav ? lp.lp_investor_deal_ids : [],
    lp_investor_role_display: lpNav ? lp.lp_investor_role_display : null,
    /** Alias for clients; same as `lp_investor_nav` when LP email scope applies. */
    is_lp_investor: lpNav,
  };
}
