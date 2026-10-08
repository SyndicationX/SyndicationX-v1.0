/**
 * Contact offering visibility — CRM preference applied only in Investing Mode.
 */
import { inArray, sql } from "drizzle-orm";
import { db, pool } from "../../database/db.js";
import { addDealForm } from "../../schema/deal.schema/add-deal-form.schema.js";
import { companies } from "../../schema/company.schema/company.js";
import { contact, users } from "../../schema/schema.js";
import { filterDealIdsVisibleToInvestors } from "../deal/dealFormCompleteness.service.js";

export type ContactOfferingVisibility =
  | "ALL_OFFERINGS"
  | "HIDE_OFFERINGS"
  | "506B_ONLY"
  | "506C_ONLY";

const VISIBILITY_RANK: Record<ContactOfferingVisibility, number> = {
  ALL_OFFERINGS: 0,
  "506B_ONLY": 1,
  "506C_ONLY": 1,
  HIDE_OFFERINGS: 2,
};

/**
 * Normalize API/DB values. Empty / unknown → `null` (unset).
 * Still accepts legacy aliases (`show` / `hide` / `506c`) from older clients.
 */
export function normalizeContactOfferingVisibility(
  raw: unknown,
): ContactOfferingVisibility | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s()-]+/g, "_");
  if (!s) return null;
  if (
    s === "ALL_OFFERINGS" ||
    s === "ALL" ||
    s === "SHOW" ||
    s === "SHOW_OFFERINGS"
  )
    return "ALL_OFFERINGS";
  if (s === "HIDE_OFFERINGS" || s === "HIDE" || s === "HIDDEN")
    return "HIDE_OFFERINGS";
  if (
    s === "506B_ONLY" ||
    s === "506B" ||
    s === "506_B" ||
    s === "506_B_ONLY" ||
    s === "506B_OFFERINGS_ONLY"
  )
    return "506B_ONLY";
  if (
    s === "506C_ONLY" ||
    s === "506C" ||
    s === "506_C" ||
    s === "506_C_ONLY" ||
    s === "506C_OFFERINGS_ONLY"
  )
    return "506C_ONLY";
  return null;
}

/** Deal `sec_type` values that count as 506(b) offerings. */
export function isDealSecType506b(secType: string | null | undefined): boolean {
  const raw = String(secType ?? "").trim();
  if (!raw) return false;
  const s = raw
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[\s-]+/g, "_");
  if (
    s === "506_b" ||
    s === "506b" ||
    s === "regulation_506_b" ||
    s === "reg_506_b" ||
    s === "reg_d_506_b" ||
    s === "regulation_d_506_b"
  ) {
    return true;
  }
  return /(?:^|_)506_?b(?:_|$)/.test(s) || /506\s*\(?\s*b\s*\)?/i.test(raw);
}

/** Deal `sec_type` values that count as 506(c) offerings. */
export function isDealSecType506c(secType: string | null | undefined): boolean {
  const raw = String(secType ?? "").trim();
  if (!raw) return false;
  const s = raw
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[\s-]+/g, "_");
  if (
    s === "506_c" ||
    s === "506c" ||
    s === "regulation_506_c" ||
    s === "reg_506_c" ||
    s === "reg_d_506_c" ||
    s === "regulation_d_506_c"
  ) {
    return true;
  }
  // Label-like values e.g. "506(c)" / "Reg D 506(c)" after stripping punctuation.
  return /(?:^|_)506_?c(?:_|$)/.test(s) || /506\s*\(?\s*c\s*\)?/i.test(raw);
}

/**
 * Offering visibility for this email in each organization that has a CRM
 * contact row. A setting in one company does not apply to another company.
 * Unset in an organization stays unset for 506(b). That organization's 506(c)
 * offerings stay visible to every contact there, whatever this setting is.
 * When that organization has several rows, the most restrictive choice wins.
 */
async function contactVisibilityByOrganization(
  emailNorm: string,
): Promise<Map<string, ContactOfferingVisibility | null>> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return new Map();

  const rows = await db
    .select({
      organizationId: contact.organizationId,
      createdBy: contact.createdBy,
      showOfferingsVisibility: contact.showOfferingsVisibility,
    })
    .from(contact)
    .where(sql`lower(trim(${contact.email})) = ${e}`);

  const creatorIds = [
    ...new Set(
      rows
        .filter((row) => !String(row.organizationId ?? "").trim() && row.createdBy)
        .map((row) => String(row.createdBy)),
    ),
  ];
  const creatorOrgByUserId = new Map<string, string>();
  if (creatorIds.length > 0) {
    const creators = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
      })
      .from(users)
      .where(inArray(users.id, creatorIds));
    for (const creator of creators) {
      const orgId = String(creator.organizationId ?? "").trim().toLowerCase();
      if (orgId) creatorOrgByUserId.set(String(creator.id), orgId);
    }
  }

  const ranked = new Map<
    string,
    { visibility: ContactOfferingVisibility | null; rank: number }
  >();
  for (const row of rows) {
    const ownOrg = String(row.organizationId ?? "").trim().toLowerCase();
    const orgId =
      ownOrg ||
      creatorOrgByUserId.get(String(row.createdBy ?? "")) ||
      "";
    if (!orgId) continue;
    const chosen = normalizeContactOfferingVisibility(row.showOfferingsVisibility);
    const prev = ranked.get(orgId);
    if (!prev) {
      ranked.set(orgId, {
        visibility: chosen,
        rank: chosen ? VISIBILITY_RANK[chosen] : -1,
      });
      continue;
    }
    if (!chosen) continue;
    if (prev.visibility == null || VISIBILITY_RANK[chosen] > prev.rank) {
      ranked.set(orgId, {
        visibility: chosen,
        rank: VISIBILITY_RANK[chosen],
      });
    }
  }

  return new Map(
    [...ranked.entries()].map(([orgId, row]) => [orgId, row.visibility]),
  );
}

type OrgDealRow = {
  id: string;
  secType: string | null;
  organizationId: string;
};

/** Deals owned by these companies, including rows saved before organization_id was set. */
async function listDealsInOrganizations(orgIds: string[]): Promise<OrgDealRow[]> {
  const ids = [...new Set(orgIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return [];
  const companiesRows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, ids));
  const orgIdByName = new Map<string, string>();
  for (const company of companiesRows) {
    const name = String(company.name ?? "").trim().toLowerCase();
    const id = String(company.id ?? "").trim().toLowerCase();
    if (name && id && !orgIdByName.has(name)) orgIdByName.set(name, id);
  }

  const res = await pool.query<{
    id: string;
    sec_type: string | null;
    organization_id: string | null;
    owning_entity_name: string | null;
  }>(
    `SELECT d.id::text AS id,
            d.sec_type,
            d.organization_id::text AS organization_id,
            d.owning_entity_name
     FROM add_deal_form d
     WHERE d.organization_id = ANY($1::uuid[])
        OR (
          d.organization_id IS NULL
          AND EXISTS (
            SELECT 1 FROM companies co
            WHERE co.id = ANY($1::uuid[])
              AND lower(trim(co.name)) = lower(trim(d.owning_entity_name))
          )
        )`,
    [ids],
  );

  const out: OrgDealRow[] = [];
  for (const row of res.rows) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const storedOrg = String(row.organization_id ?? "").trim().toLowerCase();
    const namedOrg =
      orgIdByName.get(String(row.owning_entity_name ?? "").trim().toLowerCase()) ??
      "";
    const organizationId = ids.includes(storedOrg) ? storedOrg : namedOrg;
    if (!organizationId || !ids.includes(organizationId)) continue;
    out.push({
      id,
      secType: row.sec_type,
      organizationId,
    });
  }
  return out;
}

/**
 * Resolve visibility for a portal user email from CRM contact rows.
 * When several organizations match, the most restrictive preference wins.
 * Prefer {@link contactVisibilityByOrganization} when deals belong to
 * different companies.
 */
export async function resolveContactOfferingVisibilityForEmail(
  emailNorm: string,
): Promise<ContactOfferingVisibility | null> {
  const byOrg = await contactVisibilityByOrganization(emailNorm);
  let best: ContactOfferingVisibility | null = null;
  for (const visibility of byOrg.values()) {
    if (!visibility) continue;
    if (!best || VISIBILITY_RANK[visibility] > VISIBILITY_RANK[best]) {
      best = visibility;
    }
  }
  return best;
}

const INVITING_SPONSOR_ROLES_SQL = `'lead sponsor', 'admin sponsor', 'co-sponsor', 'co sponsor'`;

const invitingSponsorRosterDealIdsInflight = new Map<
  string,
  Promise<Set<string>>
>();

/**
 * Deals where a sponsor who invited or linked this contact is Lead, Admin, or
 * Co-sponsor, including deals in another organization.
 */
async function listDealIdsWhereInvitingSponsorIsOnRoster(
  emailNorm: string,
): Promise<Set<string>> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return new Set();
  const inflight = invitingSponsorRosterDealIdsInflight.get(e);
  if (inflight) return inflight;
  const pending = pool
    .query<{ deal_id: string }>(
      `WITH sponsor_ids AS (
         SELECT DISTINCT adder_u.id::text AS sponsor_user_id
         FROM deal_lp_investor lp
         INNER JOIN users viewer_u ON lower(trim(viewer_u.email)) = $1
         INNER JOIN users adder_u ON adder_u.id = lp.added_by
         INNER JOIN deal_member dm_sponsor ON
           dm_sponsor.deal_id = lp.deal_id
           AND dm_sponsor.is_draft = false
           AND lower(trim(dm_sponsor.deal_member_role)) IN (
             ${INVITING_SPONSOR_ROLES_SQL}
           )
           AND (
             trim(dm_sponsor.contact_member_id) = adder_u.id::text
             OR EXISTS (
               SELECT 1 FROM contact c
               WHERE c.id::text = trim(both from dm_sponsor.contact_member_id)
                 AND lower(trim(c.email)) = lower(trim(adder_u.email))
             )
           )
         WHERE lp.added_by IS NOT NULL
           AND lp.is_draft = false
           AND (
             trim(lp.contact_member_id) = viewer_u.id::text
             OR (
               nullif(trim(lp.email), '') IS NOT NULL
               AND lower(trim(lp.email)) = $1
             )
             OR EXISTS (
               SELECT 1 FROM contact c2
               WHERE c2.id::text = trim(both from lp.contact_member_id)
                 AND lower(trim(c2.email)) = $1
             )
           )
         UNION
         SELECT DISTINCT adder_u.id::text AS sponsor_user_id
         FROM deal_member dm_investor
         INNER JOIN users viewer_u ON lower(trim(viewer_u.email)) = $1
         INNER JOIN users adder_u ON adder_u.id = dm_investor.added_by
         INNER JOIN deal_member dm_sponsor ON
           dm_sponsor.deal_id = dm_investor.deal_id
           AND dm_sponsor.is_draft = false
           AND lower(trim(dm_sponsor.deal_member_role)) IN (
             ${INVITING_SPONSOR_ROLES_SQL}
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
           AND dm_investor.is_draft = false
           AND (
             trim(dm_investor.contact_member_id) = viewer_u.id::text
             OR EXISTS (
               SELECT 1 FROM contact c2
               WHERE c2.id::text = trim(both from dm_investor.contact_member_id)
                 AND lower(trim(c2.email)) = $1
             )
           )
         UNION
         SELECT DISTINCT ref_u.id::text AS sponsor_user_id
         FROM users viewer_u
         INNER JOIN users ref_u ON ref_u.id = viewer_u.referred_by_user_id
         WHERE lower(trim(viewer_u.email)) = $1
           AND viewer_u.referred_by_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM deal_member dm
             WHERE dm.is_draft = false
               AND lower(trim(dm.deal_member_role)) IN (
                 ${INVITING_SPONSOR_ROLES_SQL}
               )
               AND (
                 trim(dm.contact_member_id) = ref_u.id::text
                 OR EXISTS (
                   SELECT 1 FROM contact c_s
                   WHERE c_s.id::text = trim(both from dm.contact_member_id)
                     AND lower(trim(c_s.email)) = lower(trim(ref_u.email))
                 )
               )
           )
         UNION
         SELECT DISTINCT creator_u.id::text AS sponsor_user_id
         FROM contact c_inv
         INNER JOIN users creator_u ON creator_u.id = c_inv.created_by
         WHERE lower(trim(c_inv.email)) = $1
           AND EXISTS (
             SELECT 1 FROM deal_member dm
             WHERE dm.is_draft = false
               AND lower(trim(dm.deal_member_role)) IN (
                 ${INVITING_SPONSOR_ROLES_SQL}
               )
               AND (
                 trim(dm.contact_member_id) = creator_u.id::text
                 OR EXISTS (
                   SELECT 1 FROM contact c_s
                   WHERE c_s.id::text = trim(both from dm.contact_member_id)
                     AND lower(trim(c_s.email)) = lower(trim(creator_u.email))
                 )
               )
           )
       )
       SELECT DISTINCT dm.deal_id::text AS deal_id
       FROM deal_member dm
       WHERE dm.is_draft = false
         AND lower(trim(dm.deal_member_role)) IN (
           ${INVITING_SPONSOR_ROLES_SQL}
         )
         AND EXISTS (SELECT 1 FROM sponsor_ids)
         AND (
           trim(dm.contact_member_id) IN (
             SELECT sponsor_user_id FROM sponsor_ids
           )
           OR EXISTS (
             SELECT 1 FROM users su
             INNER JOIN contact c
               ON c.id::text = trim(both from dm.contact_member_id)
             WHERE su.id::text IN (SELECT sponsor_user_id FROM sponsor_ids)
               AND lower(trim(c.email)) = lower(trim(su.email))
           )
         )`,
      [e],
    )
    .then(
      (res) =>
        new Set(
          res.rows
            .map((r) => String(r.deal_id ?? "").trim().toLowerCase())
            .filter(Boolean),
        ),
    )
    .finally(() => {
      invitingSponsorRosterDealIdsInflight.delete(e);
    });
  invitingSponsorRosterDealIdsInflight.set(e, pending);
  return pending;
}

/**
 * Deals this email is already on (LP roster, deal member, or investment).
 * Used so an unset visibility still shows a 506(b) deal they belong to.
 */
async function listDealIdsInvestorIsPartOf(emailNorm: string): Promise<Set<string>> {
  const e = String(emailNorm ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return new Set();
  const res = await pool.query<{ deal_id: string }>(
    `SELECT DISTINCT src.deal_id
     FROM (
       SELECT dli.deal_id::text AS deal_id
       FROM deal_lp_investor dli
       WHERE dli.is_draft = false
         AND (
           lower(trim(dli.email)) = $1
           OR EXISTS (
             SELECT 1 FROM contact c
             WHERE c.id::text = trim(both from dli.contact_member_id)
               AND lower(trim(c.email)) = $1
           )
           OR EXISTS (
             SELECT 1 FROM users u
             WHERE u.id::text = trim(both from dli.contact_member_id)
               AND lower(trim(u.email)) = $1
           )
         )
       UNION
       SELECT dm.deal_id::text AS deal_id
       FROM deal_member dm
       WHERE dm.is_draft = false
         AND (
           EXISTS (
             SELECT 1 FROM contact c
             WHERE c.id::text = trim(both from dm.contact_member_id)
               AND lower(trim(c.email)) = $1
           )
           OR EXISTS (
             SELECT 1 FROM users u
             WHERE u.id::text = trim(both from dm.contact_member_id)
               AND lower(trim(u.email)) = $1
           )
         )
       UNION
       SELECT di.deal_id::text AS deal_id
       FROM deal_investment di
       WHERE di.is_draft = false
         AND (
           EXISTS (
             SELECT 1 FROM contact c
             WHERE c.id::text = trim(both from di.contact_id)
               AND lower(trim(c.email)) = $1
           )
           OR EXISTS (
             SELECT 1 FROM users u
             WHERE u.id::text = trim(both from di.contact_id)
               AND lower(trim(u.email)) = $1
           )
         )
     ) src
     WHERE nullif(trim(src.deal_id), '') IS NOT NULL`,
    [e],
  );
  return new Set(
    res.rows
      .map((r) => String(r.deal_id ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * No visibility chosen: 506(c) offerings, plus a 506(b) deal only when this
 * investor is already on that deal.
 */
function dealAllowedWhenVisibilityUnset(
  secType: string | null | undefined,
  dealId: string,
  participantDealIds: Set<string>,
): boolean {
  if (isDealSecType506c(secType)) return true;
  if (
    isDealSecType506b(secType) &&
    participantDealIds.has(dealId.trim().toLowerCase())
  ) {
    return true;
  }
  return false;
}

function dealMatchesOrganizationVisibility(
  visibility: ContactOfferingVisibility | null,
  secType: string | null | undefined,
  dealId: string,
  participantDealIds: Set<string>,
): boolean {
  // A deal this investor is already on stays open. Hide / 506-only still
  // applies to the rest of that company's offerings.
  if (participantDealIds.has(dealId.trim().toLowerCase())) return true;
  // 506(c) of this sponsor's organization is visible to every contact there.
  if (isDealSecType506c(secType)) return true;
  if (visibility === "ALL_OFFERINGS") return true;
  if (visibility === "HIDE_OFFERINGS") return false;
  if (visibility === "506B_ONLY") return isDealSecType506b(secType);
  if (visibility === "506C_ONLY") return false;
  return dealAllowedWhenVisibilityUnset(secType, dealId, participantDealIds);
}

/**
 * Deals from every organization where this email is a contact.
 * 506(c) offerings in that organization are always included. Offering
 * visibility only limits 506(b) and other non-506(c) deals.
 */
export async function listContactOrganizationInvestingDealIds(
  emailNorm: string,
): Promise<string[] | null> {
  const byOrg = await contactVisibilityByOrganization(emailNorm);
  const orgIds = [...byOrg.keys()];
  if (orgIds.length === 0) return null;

  const rows = await listDealsInOrganizations(orgIds);

  const participantDealIds = await listDealIdsInvestorIsPartOf(emailNorm);
  const allowed: string[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const orgId = String(row.organizationId ?? "").trim().toLowerCase();
    if (!id || !byOrg.has(orgId)) continue;
    if (
      dealMatchesOrganizationVisibility(
        byOrg.get(orgId) ?? null,
        row.secType,
        id,
        participantDealIds,
      )
    ) {
      allowed.push(id);
    }
  }
  return filterDealIdsVisibleToInvestors(allowed);
}

/**
 * Filter deal ids by offering visibility on the contact row in each deal's
 * organization. One company's Hide or 506(c) only does not hide another
 * company's deals.
 */
export async function filterDealIdsByContactOfferingVisibility(
  emailNorm: string,
  dealIds: string[],
): Promise<string[]> {
  const ids = [
    ...new Set(dealIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return [];

  const byOrg = await contactVisibilityByOrganization(emailNorm);
  const orgDeals = await listDealsInOrganizations([...byOrg.keys()]);
  const orgIdByDealId = new Map(
    orgDeals.map((row) => [row.id.toLowerCase(), row.organizationId]),
  );
  const rows = await db
    .select({
      id: addDealForm.id,
      secType: addDealForm.secType,
      organizationId: addDealForm.organizationId,
    })
    .from(addDealForm)
    .where(inArray(addDealForm.id, ids));

  const [participantDealIds, invitingSponsorDealIds] = await Promise.all([
    listDealIdsInvestorIsPartOf(emailNorm),
    listDealIdsWhereInvitingSponsorIsOnRoster(emailNorm),
  ]);
  const allowed = new Set<string>();
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const orgId =
      orgIdByDealId.get(id.toLowerCase()) ||
      String(row.organizationId ?? "").trim().toLowerCase();
    if (byOrg.has(orgId)) {
      if (
        dealMatchesOrganizationVisibility(
          byOrg.get(orgId) ?? null,
          row.secType,
          id,
          participantDealIds,
        )
      ) {
        allowed.add(id);
      }
      continue;
    }
    if (participantDealIds.has(id.toLowerCase())) {
      allowed.add(id);
      continue;
    }
    /**
     * Another organization's deal stays visible when the sponsor who invited
     * this contact is a sponsor on that deal.
     */
    if (invitingSponsorDealIds.has(id.toLowerCase())) {
      allowed.add(id);
    }
  }
  return ids.filter((id) => allowed.has(id));
}

export async function isDealAllowedByContactOfferingVisibility(params: {
  emailNorm: string;
  dealId: string;
  secType?: string | null;
}): Promise<boolean> {
  const emailNorm = String(params.emailNorm ?? "").trim().toLowerCase();
  const dealId = String(params.dealId ?? "").trim();
  if (!emailNorm || !dealId) return true;

  const [deal] = await db
    .select({
      secType: addDealForm.secType,
      organizationId: addDealForm.organizationId,
    })
    .from(addDealForm)
    .where(sql`${addDealForm.id}::text = ${dealId}`)
    .limit(1);
  if (!deal) return false;

  const byOrg = await contactVisibilityByOrganization(emailNorm);
  const orgDeals = await listDealsInOrganizations([...byOrg.keys()]);
  const matchedOrg = orgDeals.find(
    (row) => row.id.toLowerCase() === dealId.toLowerCase(),
  );
  const orgId =
    matchedOrg?.organizationId ||
    String(deal.organizationId ?? "").trim().toLowerCase();
  const [participantDealIds, invitingSponsorDealIds] = await Promise.all([
    listDealIdsInvestorIsPartOf(emailNorm),
    listDealIdsWhereInvitingSponsorIsOnRoster(emailNorm),
  ]);
  const secType = params.secType ?? deal.secType;
  if (participantDealIds.has(dealId.toLowerCase())) return true;
  if (byOrg.has(orgId)) {
    return dealMatchesOrganizationVisibility(
      byOrg.get(orgId) ?? null,
      secType,
      dealId,
      participantDealIds,
    );
  }
  if (invitingSponsorDealIds.has(dealId.toLowerCase())) return true;
  return false;
}
