import emailConfig, {
  outgoingMailCcBcc,
  smtpEnvelopeForSendMail,
} from "../../functions/emailconfig.js";
import {
  buildMemberAccessUpdatedEmailHtml,
  buildMemberAccessUpdatedEmailText,
} from "../../functions/memberAccessUpdatedEmail.template.js";

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

function resolvedSignInPageUrl(): string {
  const explicit =
    process.env.SIGNIN_PAGE_URL?.trim() ||
    process.env.PORTAL_SIGNIN_URL?.trim() ||
    "";
  if (explicit) return explicit.replace(/\/$/, "");
  const origin = frontendBaseUrl();
  if (!origin) return "";
  return `${origin}/signin`;
}

function greetingNameFromParts(firstName: string, lastName: string): string {
  const parts = [firstName.trim(), lastName.trim()].filter(Boolean);
  if (parts.length === 0) return "there";
  return parts.join(" ");
}

export function memberRoleLabel(role: string): string {
  const r = String(role ?? "").trim().toLowerCase();
  const byCode: Record<string, string> = {
    platform_admin: "Platform Admin",
    platform_user: "Platform user",
    user: "Platform user",
    company_admin: "Company Admin",
    company_user: "Company Member",
    deal_participant: "Deal Participant",
    investor: "Investor",
  };
  return byCode[r] || String(role ?? "").trim() || "Member";
}

export async function sendMemberAccessUpdatedEmail(input: {
  toEmail: string;
  firstName: string;
  lastName: string;
  lines: string[];
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const to = input.toEmail.trim().toLowerCase();
  const lines = input.lines.map((line) => line.trim()).filter(Boolean);
  if (!to || !to.includes("@") || lines.length === 0) {
    return { ok: false, error: new Error("Nothing to email") };
  }

  const fromAddress = process.env.SENDER_EMAIL_ID?.trim() || "";
  if (!fromAddress) {
    return {
      ok: false,
      error: new Error("SENDER_EMAIL_ID must be set."),
    };
  }
  const signInUrl = resolvedSignInPageUrl();
  if (!signInUrl) {
    return {
      ok: false,
      error: new Error("Set FRONTEND_URL or SIGNIN_PAGE_URL for the sign-in link."),
    };
  }

  const content = {
    greetingName: greetingNameFromParts(input.firstName, input.lastName),
    recipientEmail: to,
    signInUrl,
    lines,
  };

  try {
    const transporter = emailConfig();
    const ccBcc = outgoingMailCcBcc();
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
      subject: "Your SyndicationX access was updated",
      text: buildMemberAccessUpdatedEmailText(content),
      html: buildMemberAccessUpdatedEmailHtml(content),
    });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}
