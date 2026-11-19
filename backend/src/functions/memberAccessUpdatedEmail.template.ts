import {
  buildSyndicationXEmailAuthFooterHtml,
  buildSyndicationXEmailBrandHeaderHtml,
  buildSyndicationXEmailSignatureText,
  SX_EMAIL_BUTTON_STYLE,
  SX_EMAIL_MUTED,
  SX_EMAIL_PAGE_BG,
} from "./emailSyndicationXLayout.js";

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type MemberAccessUpdatedEmailContent = {
  greetingName: string;
  recipientEmail: string;
  signInUrl: string;
  lines: string[];
};

export function buildMemberAccessUpdatedEmailText(
  params: MemberAccessUpdatedEmailContent,
): string {
  return [
    "Your account access was updated",
    "",
    `Hi ${params.greetingName},`,
    "",
    "An administrator updated your SyndicationX account.",
    "",
    ...params.lines,
    "",
    "Sign in again to continue with your updated access.",
    params.signInUrl,
    "",
    `This message was sent to: ${params.recipientEmail}`,
    "",
    buildSyndicationXEmailSignatureText(),
  ].join("\n");
}

export function buildMemberAccessUpdatedEmailHtml(
  params: MemberAccessUpdatedEmailContent,
): string {
  const escName = escHtmlText(params.greetingName);
  const escEmail = escHtmlText(params.recipientEmail);
  const safeHref = escAttr(params.signInUrl);
  const changes = params.lines
    .map(
      (line) =>
        `<p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;">${escHtmlText(line)}</p>`,
    )
    .join("");
  const header = buildSyndicationXEmailBrandHeaderHtml();
  const authFooter = buildSyndicationXEmailAuthFooterHtml();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your account access was updated · SyndicationX</title>
</head>
<body style="margin:0;padding:0;background:${SX_EMAIL_PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;">
  ${header}
  <h1 style="color:#111827;font-size:26px;line-height:1.25;margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-weight:700;">Your account access was updated</h1>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;">Hi ${escName},</p>
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;">An administrator updated your SyndicationX account.</p>
  ${changes}
  <p style="font-size:16px;line-height:1.6;color:#111827;margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;">Sign in again to continue with your updated access.</p>
  <div style="margin:24px 0;">
    <a href="${safeHref}" style="${SX_EMAIL_BUTTON_STYLE}">Sign in</a>
  </div>
  <p style="font-size:13px;line-height:1.5;color:${SX_EMAIL_MUTED};margin:0;font-family:Arial,Helvetica,sans-serif;">Sent to <strong style="color:#374151;">${escEmail}</strong></p>
  ${authFooter}
</div>
</body>
</html>`;
}
