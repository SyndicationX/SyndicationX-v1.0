import emailConfig, {
  outgoingMailCcBcc,
  smtpEnvelopeForSendMail,
} from "../../functions/emailconfig.js";
import {
  buildInvestorSponsorUpdatedInvestorEmailHtml,
  buildInvestorSponsorUpdatedInvestorEmailText,
  buildInvestorSponsorUpdatedSponsorEmailHtml,
  buildInvestorSponsorUpdatedSponsorEmailText,
  type InvestorSponsorUpdatedTemplateVars,
} from "../../functions/investorSponsorUpdatedEmail.template.js";
import { getAddDealFormById } from "./dealForm.service.js";
import { buildDealMemberInviteLandingUrl } from "./dealMemberInviteToken.service.js";
import { resolveEmailForContactMemberId } from "./dealMemberInvitationEmail.service.js";

const SENDER_DISPLAY_NAME =
  process.env.SENDER_DISPLAY_NAME?.trim() || "SyndicationX";

async function sendNotice(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const fromAddress = process.env.SENDER_EMAIL_ID?.trim() || "";
  if (!fromAddress) {
    console.warn("sendInvestorSponsorUpdatedEmails: SENDER_EMAIL_ID not set");
    return;
  }
  const transporter = emailConfig();
  const ccBcc = outgoingMailCcBcc();
  await transporter.sendMail({
    from: { name: SENDER_DISPLAY_NAME, address: fromAddress },
    to: input.to,
    ...ccBcc,
    envelope: smtpEnvelopeForSendMail({
      fromAddress,
      to: input.to,
      cc: ccBcc.cc,
      bcc: ccBcc.bcc,
    }),
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

async function firstInvestorEmail(contactIds: string[]): Promise<string> {
  for (const contactId of contactIds) {
    const email = await resolveEmailForContactMemberId(contactId);
    if (email) return email;
  }
  return "";
}

/**
 * Tells the investor who their sponsor is now, and tells that sponsor
 * which investor they were assigned. A failed send does not undo the update.
 */
export async function sendInvestorSponsorUpdatedEmails(input: {
  dealId: string;
  investorContactIds: string[];
  investorDisplayName: string;
  sponsorDisplayName: string;
  sponsorEmail: string;
}): Promise<void> {
  const dealId = input.dealId.trim();
  if (!dealId) return;

  const investorEmail = await firstInvestorEmail(input.investorContactIds);
  const sponsorEmail = String(input.sponsorEmail ?? "").trim().toLowerCase();
  if (!investorEmail && !sponsorEmail.includes("@")) {
    console.warn(
      "sendInvestorSponsorUpdatedEmails: no investor or sponsor email",
      dealId,
    );
    return;
  }

  const deal = await getAddDealFormById(dealId);
  const dealName = deal?.dealName?.trim() || "this deal";
  const investorDisplayName = input.investorDisplayName.trim() || "this investor";
  const sponsorDisplayName = input.sponsorDisplayName.trim() || "your sponsor";
  const base = {
    dealName,
    investorDisplayName,
    investorEmail: investorEmail || sponsorEmail,
    sponsorDisplayName,
    sponsorEmail: sponsorEmail || investorEmail,
    senderBrand: SENDER_DISPLAY_NAME,
  };

  if (investorEmail) {
    try {
      const portalDealUrl =
        (await buildDealMemberInviteLandingUrl(dealId, investorEmail)) || "";
      const vars: InvestorSponsorUpdatedTemplateVars = {
        ...base,
        portalDealUrl,
      };
      await sendNotice({
        to: investorEmail,
        subject: `Your sponsor was updated — ${dealName}`,
        text: buildInvestorSponsorUpdatedInvestorEmailText(vars),
        html: buildInvestorSponsorUpdatedInvestorEmailHtml(vars),
      });
    } catch (error: unknown) {
      console.warn(
        "sendInvestorSponsorUpdatedEmails: investor send failed",
        error,
      );
    }
  }

  if (sponsorEmail.includes("@") && sponsorEmail !== investorEmail) {
    try {
      const portalDealUrl =
        (await buildDealMemberInviteLandingUrl(dealId, sponsorEmail)) || "";
      const vars: InvestorSponsorUpdatedTemplateVars = {
        ...base,
        portalDealUrl,
      };
      await sendNotice({
        to: sponsorEmail,
        subject: `You are now a sponsor — ${dealName}`,
        text: buildInvestorSponsorUpdatedSponsorEmailText(vars),
        html: buildInvestorSponsorUpdatedSponsorEmailHtml(vars),
      });
    } catch (error: unknown) {
      console.warn(
        "sendInvestorSponsorUpdatedEmails: sponsor send failed",
        error,
      );
    }
  }
}
