import { eq } from "drizzle-orm";
import { isPlatformAdminRole } from "../../constants/roles.js";
import { db } from "../../database/db.js";
import { users } from "../../schema/schema.js";
import { isPortalUserLeadOrAdminSponsorOnDeal } from "../deal/dealMemberScope.service.js";

/**
 * Investor bank account setup details on a deal: platform admins and the
 * deal's Lead Sponsor / Admin sponsor only. Co-sponsors, company admins and
 * other workspace viewers see the Set Up / Not Set Up badge only.
 */
export async function viewerMayViewInvestorBankAccountDetails(params: {
  dealId: string;
  userId: string;
  jwtUserRole?: string | null;
}): Promise<boolean> {
  const userId = params.userId.trim();
  const dealId = params.dealId.trim();
  if (!userId || !dealId) return false;
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const role = String(row?.role ?? "").trim() || String(params.jwtUserRole ?? "");
  if (isPlatformAdminRole(role)) return true;
  return isPortalUserLeadOrAdminSponsorOnDeal(dealId, userId);
}
