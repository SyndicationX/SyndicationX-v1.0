import type { Request, Response } from "express";
import { getValidJwtUser } from "../../middleware/jwtUser.js";
import {
  assertDealIdReadableOrAssignedParticipant,
  resolveDealViewerScope,
} from "../../services/deal/dealAccess.service.js";
import { isPortalUserLeadSponsorOnDeal } from "../../services/deal/dealMemberScope.service.js";
import {
  listInvestorSponsorOptions,
  updateInvestorSponsor,
} from "../../services/deal/dealInvestorSponsor.service.js";
import { requestedOrganizationIdFromRequest } from "../../services/org/orgResolution.service.js";

function routeParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function authorizeLeadSponsor(
  req: Request,
  res: Response,
): Promise<{ dealId: string; rowId: string; actorUserId: string } | null> {
  const user = await getValidJwtUser(req);
  if (!user?.id) {
    res.status(401).json({ message: "Authorization required" });
    return null;
  }
  const dealId = routeParam(req.params.dealId);
  const rowId = routeParam(req.params.investorRowId);
  if (!dealId || !rowId) {
    res.status(400).json({ message: "Missing deal or investor id" });
    return null;
  }
  const scope = await resolveDealViewerScope(
    user.id,
    user.userRole,
    requestedOrganizationIdFromRequest(req),
  );
  if (!(await assertDealIdReadableOrAssignedParticipant(dealId, scope))) {
    res.status(404).json({ message: "Deal not found" });
    return null;
  }
  if (!(await isPortalUserLeadSponsorOnDeal(dealId, user.id))) {
    res.status(403).json({
      message: "Only the lead sponsor can update an investor's sponsor.",
    });
    return null;
  }
  return { dealId, rowId, actorUserId: user.id };
}

/** GET /deals/:dealId/investors/:investorRowId/sponsor-options */
export async function getInvestorSponsorOptions(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const auth = await authorizeLeadSponsor(req, res);
    if (!auth) return;
    const result = await listInvestorSponsorOptions(auth.dealId, auth.rowId);
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.status(200).json(result.options);
  } catch (err) {
    console.error("getInvestorSponsorOptions:", err);
    res.status(500).json({ message: "Could not load sponsors" });
  }
}

/** PATCH /deals/:dealId/investors/:investorRowId/sponsor */
export async function patchInvestorSponsor(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const auth = await authorizeLeadSponsor(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sponsorUserId = String(
      body.sponsor_user_id ?? body.sponsorUserId ?? "",
    ).trim();
    const result = await updateInvestorSponsor({
      dealId: auth.dealId,
      rowId: auth.rowId,
      sponsorUserId,
      actorUserId: auth.actorUserId,
    });
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("patchInvestorSponsor:", err);
    res.status(500).json({ message: "Could not update the sponsor" });
  }
}
