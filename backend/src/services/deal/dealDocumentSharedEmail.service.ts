import emailConfig, {
  outgoingMailCcBcc,
  smtpEnvelopeForSendMail,
} from "../../functions/emailconfig.js";
import {
  buildDealDocumentSharedEmailHtml,
  buildDealDocumentSharedEmailText,
} from "../../functions/dealDocumentSharedEmail.template.js";
import { getAddDealFormById } from "./dealForm.service.js";

const SENDER_DISPLAY_NAME =
  process.env.SENDER_DISPLAY_NAME?.trim() || "SyndicationX";

function frontendBaseUrl(): string {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.BASE_URL,
    process.env.APP_URL,
    process.env.CLIENT_URL,
    process.env.PUBLIC_APP_URL,
    process.env.VITE_BASE_URL,
  ];
  for (const raw of candidates) {
    const t = String(raw ?? "").trim();
    if (t) return t.replace(/\/$/, "");
  }
  return "";
}

/** Investing deal page, documents block, after sign-in. */
function investingDocumentsReturnPath(dealId: string): string {
  const id = dealId.trim();
  return `/deals/${encodeURIComponent(id)}?portal=investing&focus=documents`;
}

function resolvedDocumentsUrl(dealId: string): string {
  const origin = frontendBaseUrl();
  if (!origin || !dealId.trim()) return "";
  const next = investingDocumentsReturnPath(dealId);
  return `${origin}/signin?next=${encodeURIComponent(next)}`;
}

export interface SendDealDocumentSharedEmailParams {
  dealId: string;
  toEmail: string;
  memberDisplayName?: string;
  documentNames: string[];
}

export async function sendDealDocumentSharedEmail(
  params: SendDealDocumentSharedEmailParams,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const to = params.toEmail.trim().toLowerCase();
  if (!to.includes("@")) {
    return { ok: false, error: new Error("Invalid recipient email") };
  }

  const deal = await getAddDealFormById(params.dealId);
  const dealName = deal?.dealName?.trim() || "this deal";
  const memberDisplayName = params.memberDisplayName?.trim() || "";
  const documentNames = params.documentNames
    .map((n) => String(n ?? "").trim())
    .filter(Boolean);
  if (documentNames.length === 0) {
    documentNames.push("Document");
  }

  try {
    const transporter = emailConfig();
    const fromAddress = process.env.SENDER_EMAIL_ID?.trim() || "";
    if (!fromAddress) {
      return {
        ok: false,
        error: new Error(
          "SENDER_EMAIL_ID must be set (configure SMTP in .env.local).",
        ),
      };
    }

    const ccBcc = outgoingMailCcBcc();
    const templateVars = {
      dealName,
      memberDisplayName,
      memberEmail: to,
      documentNames,
      senderBrand: SENDER_DISPLAY_NAME,
      loginUrl: resolvedDocumentsUrl(params.dealId),
    };
    const subject =
      process.env.DEAL_DOCUMENT_SHARED_SUBJECT?.trim()?.replace(
        /\{dealName\}/g,
        dealName,
      ) || `A document has been shared with you — ${dealName}`;

    await transporter.sendMail({
      from: {
        name: SENDER_DISPLAY_NAME,
        address: fromAddress,
      },
      to,
      ...ccBcc,
      envelope: smtpEnvelopeForSendMail({
        fromAddress,
        to,
        cc: ccBcc.cc,
        bcc: ccBcc.bcc,
      }),
      subject,
      text: buildDealDocumentSharedEmailText(templateVars),
      html: buildDealDocumentSharedEmailHtml(templateVars),
    });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}
