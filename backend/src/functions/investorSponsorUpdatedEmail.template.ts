import {
  buildSyndicationXEmailBrandHeaderHtml,
  buildSyndicationXEmailFooterHtml,
  buildSyndicationXEmailSignatureText,
  SX_EMAIL_BUTTON_STYLE,
  SX_EMAIL_MUTED,
  SX_EMAIL_PAGE_BG,
} from "./emailSyndicationXLayout.js";

export interface InvestorSponsorUpdatedTemplateVars {
  dealName: string;
  investorDisplayName: string;
  investorEmail: string;
  sponsorDisplayName: string;
  sponsorEmail: string;
  portalDealUrl: string;
  senderBrand: string;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function viewDealBlock(url: string): string {
  if (!url) {
    return `<p style="font-size:14px;line-height:1.6;color:${SX_EMAIL_MUTED};font-family:Arial,Helvetica,sans-serif;">Sign in to SyndicationX to view this deal.</p>`;
  }
  return `<div style="margin:24px 0;">
  <a href="${escHtml(url)}" style="${SX_EMAIL_BUTTON_STYLE}">View deal on SyndicationX</a>
</div>`;
}

export function buildInvestorSponsorUpdatedInvestorEmailText(
  v: InvestorSponsorUpdatedTemplateVars,
): string {
  return [
    `Your sponsor was updated — ${v.dealName} · SyndicationX`,
    "",
    v.investorDisplayName ? `Hello ${v.investorDisplayName},` : "Hello,",
    "",
    `${v.sponsorDisplayName} is now your sponsor for ${v.dealName}.`,
    v.portalDealUrl
      ? `View the deal on SyndicationX: ${v.portalDealUrl}`
      : "Sign in to SyndicationX to view details.",
    "",
    `This message was sent to: ${v.investorEmail}`,
    "",
    buildSyndicationXEmailSignatureText({ companyName: v.senderBrand }),
  ].join("\n");
}

export function buildInvestorSponsorUpdatedInvestorEmailHtml(
  v: InvestorSponsorUpdatedTemplateVars,
): string {
  const deal = escHtml(v.dealName);
  const name = escHtml(v.investorDisplayName || "there");
  const sponsor = escHtml(v.sponsorDisplayName || "Your sponsor");
  const email = escHtml(v.investorEmail);
  const brand = escHtml(v.senderBrand);
  const header = buildSyndicationXEmailBrandHeaderHtml();
  const footer = buildSyndicationXEmailFooterHtml(brand);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your sponsor was updated · SyndicationX</title>
</head>
<body style="margin:0;padding:0;background:${SX_EMAIL_PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;">
  ${header}
  <h1 style="color:#111827;font-size:26px;line-height:1.25;margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-weight:700;">Your sponsor was updated</h1>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;">Hello ${name},</p>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;"><strong>${sponsor}</strong> is now your sponsor for <strong>${deal}</strong>.</p>
  ${viewDealBlock(v.portalDealUrl)}
  <p style="font-size:13px;line-height:1.5;color:${SX_EMAIL_MUTED};margin:20px 0 0 0;font-family:Arial,Helvetica,sans-serif;">This message was sent to <strong style="color:#374151;">${email}</strong>.</p>
  ${footer}
</div>
</body>
</html>`;
}

export function buildInvestorSponsorUpdatedSponsorEmailText(
  v: InvestorSponsorUpdatedTemplateVars,
): string {
  return [
    `You are now a sponsor — ${v.dealName} · SyndicationX`,
    "",
    v.sponsorDisplayName ? `Hello ${v.sponsorDisplayName},` : "Hello,",
    "",
    `You are now the sponsor for ${v.investorDisplayName} on ${v.dealName}.`,
    v.portalDealUrl
      ? `View the deal on SyndicationX: ${v.portalDealUrl}`
      : "Sign in to SyndicationX to view details.",
    "",
    `This message was sent to: ${v.sponsorEmail}`,
    "",
    buildSyndicationXEmailSignatureText({ companyName: v.senderBrand }),
  ].join("\n");
}

export function buildInvestorSponsorUpdatedSponsorEmailHtml(
  v: InvestorSponsorUpdatedTemplateVars,
): string {
  const deal = escHtml(v.dealName);
  const investor = escHtml(v.investorDisplayName || "this investor");
  const sponsor = escHtml(v.sponsorDisplayName || "there");
  const email = escHtml(v.sponsorEmail);
  const brand = escHtml(v.senderBrand);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You are now a sponsor · SyndicationX</title>
</head>
<body style="margin:0;padding:0;background:${SX_EMAIL_PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;">
  ${buildSyndicationXEmailBrandHeaderHtml()}
  <h1 style="color:#111827;font-size:26px;line-height:1.25;margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-weight:700;">You are now a sponsor</h1>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;">Hello ${sponsor},</p>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;">You are now the sponsor for <strong>${investor}</strong> on <strong>${deal}</strong>.</p>
  ${viewDealBlock(v.portalDealUrl)}
  <p style="font-size:13px;line-height:1.5;color:${SX_EMAIL_MUTED};margin:20px 0 0 0;font-family:Arial,Helvetica,sans-serif;">This message was sent to <strong style="color:#374151;">${email}</strong>.</p>
  ${buildSyndicationXEmailFooterHtml(brand)}
</div>
</body>
</html>`;
}
