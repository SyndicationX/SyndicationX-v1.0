import { and, eq } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  COMPANY_ADMIN,
  COMPANY_USER,
  isCompanyAdminRole,
} from "../../constants/roles.js";
import { companies, userCompanyMembership } from "../../schema/schema.js";

export type CompanyMembershipRole = typeof COMPANY_ADMIN | typeof COMPANY_USER;

export type UserCompanyMembershipView = {
  companyId: string;
  companyName: string;
  role: CompanyMembershipRole;
};

function isMissingMembershipTableError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4; i += 1) {
    if (!cur || typeof cur !== "object") break;
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "42P01") return true;
    const msg = String(e.message ?? "").toLowerCase();
    if (msg.includes('relation "user_company_membership" does not exist')) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

export function isCompanyMembershipRole(
  role: string | null | undefined,
): role is CompanyMembershipRole {
  const r = String(role ?? "").trim();
  return r === COMPANY_ADMIN || r === COMPANY_USER;
}

export function normalizeMembershipRole(
  role: string | null | undefined,
): CompanyMembershipRole {
  return isCompanyAdminRole(role) ? COMPANY_ADMIN : COMPANY_USER;
}

export async function upsertUserCompanyMembership(
  userId: string,
  companyId: string,
  role: CompanyMembershipRole,
): Promise<void> {
  const uid = String(userId ?? "").trim();
  const cid = String(companyId ?? "").trim();
  if (!uid || !cid) return;
  try {
    await db
      .insert(userCompanyMembership)
      .values({
        userId: uid,
        companyId: cid,
        role: normalizeMembershipRole(role),
      })
      .onConflictDoUpdate({
        target: [userCompanyMembership.userId, userCompanyMembership.companyId],
        set: {
          role: normalizeMembershipRole(role),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    if (isMissingMembershipTableError(err)) return;
    throw err;
  }
}

export async function hasUserCompanyMembership(
  userId: string,
  companyId: string,
): Promise<boolean> {
  const uid = String(userId ?? "").trim();
  const cid = String(companyId ?? "").trim();
  if (!uid || !cid) return false;
  let row;
  try {
    [row] = await db
      .select({ id: userCompanyMembership.id })
      .from(userCompanyMembership)
      .where(
        and(
          eq(userCompanyMembership.userId, uid),
          eq(userCompanyMembership.companyId, cid),
        ),
      )
      .limit(1);
  } catch (err) {
    if (isMissingMembershipTableError(err)) return false;
    throw err;
  }
  return row != null;
}

/**
 * My Account shows a company only when this person is on that company's staff.
 * An organization copied from the contact that invited them does not count.
 */
export async function hideFilingCompanyOnOwnProfile(
  userId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const role = String(payload.role ?? "").trim();
  const orgId = String(
    payload.organization_id ?? payload.organizationId ?? "",
  ).trim();
  const memberships = await listUserCompanyMemberships(userId);
  const matched = orgId
    ? memberships.find(
        (membership) =>
          membership.companyId.toLowerCase() === orgId.toLowerCase(),
      )
    : undefined;
  if (matched || (isCompanyMembershipRole(role) && orgId)) {
    return payload;
  }
  const ownCompany = memberships[0];
  if (ownCompany) {
    return {
      ...payload,
      organization_id: ownCompany.companyId,
      organizationId: ownCompany.companyId,
      companyName: ownCompany.companyName,
      company_name: ownCompany.companyName,
      organization_name: ownCompany.companyName,
      organizationName: ownCompany.companyName,
    };
  }
  return {
    ...payload,
    organization_id: null,
    organizationId: null,
    companyName: "",
    company_name: "",
    organization_name: "",
    organizationName: "",
  };
}

export async function listUserCompanyMemberships(
  userId: string,
): Promise<UserCompanyMembershipView[]> {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];
  let rows;
  try {
    rows = await db
      .select({
        companyId: userCompanyMembership.companyId,
        companyName: companies.name,
        role: userCompanyMembership.role,
      })
      .from(userCompanyMembership)
      .innerJoin(companies, eq(userCompanyMembership.companyId, companies.id))
      .where(eq(userCompanyMembership.userId, uid));
  } catch (err) {
    if (isMissingMembershipTableError(err)) return [];
    throw err;
  }
  return rows
    .map((r) => {
      const role = normalizeMembershipRole(r.role);
      return {
        companyId: String(r.companyId ?? "").trim(),
        companyName: String(r.companyName ?? "").trim(),
        role,
      } satisfies UserCompanyMembershipView;
    })
    .filter((r) => r.companyId !== "" && r.companyName !== "");
}
