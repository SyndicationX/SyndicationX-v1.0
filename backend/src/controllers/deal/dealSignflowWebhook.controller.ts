import type { Request, Response } from "express";
import { getSignFlowConfig } from "../../config/signflow.config.js";
import { parseSignFlowWebhookBody } from "../../services/esign/signflowWebhookParse.service.js";
import { applyInvestmentSignatureWebhookEvent } from "../../services/investment/investmentSignature.service.js";
import { handleDealInvestorEsignWebhook } from "../../services/deal/dealMemberEsignCompletion.service.js";
import { findInvestorEsignContextBySignatureRequestId } from "../../services/deal/dealMemberEsignStatus.service.js";

/**
 * POST /webhooks/signflow
 * POST /api/webhooks/signflow
 *
 * SignFlow event callback (no JWT). Updates `investment_signatures` and
 * legacy `esign_status_json` rows when documents are viewed or completed.
 */
export async function postSignFlowWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = parseSignFlowWebhookBody(req.body);
  if (!parsed) {
    console.warn("[signflow webhook] unparseable payload");
    res.sendStatus(200);
    return;
  }

  if (!getSignFlowConfig()) {
    console.warn(
      "[signflow webhook] received event but SignFlow is not configured",
      parsed.eventType,
      parsed.documentId,
    );
    res.sendStatus(200);
    return;
  }

  try {
    const sigResult = await applyInvestmentSignatureWebhookEvent({
      signatureRequestId: parsed.documentId,
      eventType: parsed.eventType,
      webhookPayload: parsed.raw,
      eventTime: parsed.eventTime,
    });

    if (!sigResult.updated) {
      console.info(
        "[signflow webhook] no investment_signatures row",
        parsed.documentId,
        parsed.eventType,
      );
    }

    const ctx = await findInvestorEsignContextBySignatureRequestId(
      parsed.documentId,
    );
    if (ctx) {
      await handleDealInvestorEsignWebhook({
        dealId: ctx.dealId,
        rosterId: ctx.target.id,
        signatureRequestId: parsed.documentId,
        eventType: parsed.eventType,
        eventTime: parsed.eventTime,
      });
    } else {
      console.info(
        "[signflow webhook] no deal investor eSign row",
        parsed.documentId,
        parsed.eventType,
      );
    }
  } catch (err) {
    console.error("[signflow webhook] handler error:", err);
  }

  res.sendStatus(200);
}
