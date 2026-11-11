import {
  buildSyndicationXEmailBrandHeaderHtml,
  buildSyndicationXEmailFooterHtml,
  buildSyndicationXEmailSignatureText,
  SX_EMAIL_MUTED,
  SX_EMAIL_PAGE_BG,
  SX_EMAIL_LINK,
} from "./emailSyndicationXLayout.js";

export interface BankAccountSetupRequestTemplateVars {
  dealName: string;
  investorDisplayName: string;
  investorEmail: string;
  senderDisplayName: string;
  senderBrand: string;
  /** Sign-in URL that returns to Investing → Profiles → Bank accounts. */
  setupUrl: string;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBankAccountSetupRequestEmailText(
  v: BankAccountSetupRequestTemplateVars,
): string {
  const requester = v.senderDisplayName || "Your sponsor";
  const lines = [
    `Set up your bank account — ${v.dealName} · SyndicationX`,
    "",
    v.investorDisplayName ? `Hello ${v.investorDisplayName},` : "Hello,",
    "",
    `${requester} has asked you to set up your bank account so you can receive ACH distributions for ${v.dealName}.`,
    "",
    "To add your bank details in Investing (Profiles → Bank accounts), open this link:",
    v.setupUrl.trim() || "(sign-in link unavailable)",
    "",
    `This message was sent to: ${v.investorEmail}`,
    "",
    buildSyndicationXEmailSignatureText({ companyName: v.senderBrand }),
  ];
  return lines.join("\n");
}

export function buildBankAccountSetupRequestEmailHtml(
  v: BankAccountSetupRequestTemplateVars,
): string {
  const greeting = v.investorDisplayName
    ? `Hello ${escHtml(v.investorDisplayName)},`
    : "Hello,";
  const deal = escHtml(v.dealName);
  const email = escHtml(v.investorEmail);
  const brand = escHtml(v.senderBrand);
  const requester = escHtml(v.senderDisplayName || "Your sponsor");
  const brandHeader = buildSyndicationXEmailBrandHeaderHtml();
  const footer = buildSyndicationXEmailFooterHtml(brand);
  const setupUrl = (v.setupUrl ?? "").trim();
  const setupHref = setupUrl ? escHtml(setupUrl) : "";
  const clickHere = setupHref
    ? `<a href="${setupHref}" style="color:${SX_EMAIL_LINK};font-weight:700;text-decoration:underline;">click here</a>`
    : "click here";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Set up your bank account</title>
</head>
<body style="margin:0;padding:0;background:${SX_EMAIL_PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;">
  ${brandHeader}
  <h1 style="color:#111827;font-size:26px;line-height:1.25;margin:0 0 18px 0;font-weight:700;">Set up your bank account</h1>
  <p style="font-size:16px;line-height:1.6;margin:0 0 12px 0;">${greeting}</p>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 8px 0;">
    ${requester} has asked you to set up your bank account so you can receive ACH distributions for <strong>${deal}</strong>.
  </p>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:20px 0 0 0;">
    To add your bank details in Investing (Profiles → Bank accounts), ${clickHere}.
  </p>
  <p style="font-size:13px;line-height:1.5;color:${SX_EMAIL_MUTED};margin:20px 0 0 0;">
    This message was sent to <strong style="color:#374151;">${email}</strong>.
  </p>
  ${footer}
</div>
</body>
</html>`;
}
