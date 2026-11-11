import { and, eq } from "drizzle-orm";
import { db } from "../../database/db.js";
import emailConfig, {
  outgoingMailCcBcc,
  smtpEnvelopeForSendMail,
} from "../../functions/emailconfig.js";
import {
  buildBankAccountSetupRequestEmailHtml,
  buildBankAccountSetupRequestEmailText,
} from "../../functions/bankAccountSetupRequestEmail.template.js";
import {
  contact,
  dealInvestment,
  userInvestorProfiles,
  users,
} from "../../schema/schema.js";
import { getAddDealFormById } from "../deal/dealForm.service.js";
import {
  findDistributionPaymentLine,
  getDistributionInvestmentBankAccountDetails,
} from "./distributionBankAccountSetup.service.js";

const SENDER_DISPLAY_NAME =
  process.env.SENDER_DISPLAY_NAME?.trim() || "SyndicationX";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function bankAccountsSetupUrl(): string {
  const origin = frontendBaseUrl();
  if (!origin) return "";
  const next = "/investing/profiles?tab=bank-accounts&portal=investing";
  return `${origin}/signin?next=${encodeURIComponent(next)}`;
}

function personName(first?: string | null, last?: string | null): string {
  return [first, last]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

async function resolveInvestorRecipient(params: {
  dealId: string;
  investmentId: string;
}): Promise<{ email: string; name: string } | null> {
  const [row] = await db
    .select({
      contactId: dealInvestment.contactId,
      contactDisplayName: dealInvestment.contactDisplayName,
      userEmail: users.email,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(dealInvestment)
    .leftJoin(
      userInvestorProfiles,
      eq(userInvestorProfiles.id, dealInvestment.userInvestorProfileId),
    )
    .leftJoin(users, eq(users.id, userInvestorProfiles.userId))
    .where(
      and(
        eq(dealInvestment.dealId, params.dealId),
        eq(dealInvestment.id, params.investmentId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const userEmail = String(row.userEmail ?? "").trim().toLowerCase();
  if (userEmail.includes("@")) {
    return {
      email: userEmail,
      name:
        personName(row.userFirstName, row.userLastName) ||
        row.contactDisplayName.trim(),
    };
  }

  const contactId = row.contactId.trim();
  if (!UUID_RE.test(contactId)) return null;
  const [crm] = await db
    .select({
      email: contact.email,
      fullName: contact.fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1);
  const crmEmail = String(crm?.email ?? "").trim().toLowerCase();
  if (!crmEmail.includes("@")) return null;
  return {
    email: crmEmail,
    name:
      crm?.fullName?.trim() ||
      personName(crm?.firstName, crm?.lastName) ||
      row.contactDisplayName.trim(),
  };
}

/**
 * Emails an investor whose distribution line is Not Set Up, asking them to add
 * bank details in Investing. Callers must check the sender may view bank
 * account details on this deal.
 */
export async function sendBankAccountSetupRequestEmail(params: {
  dealId: string;
  distributionId: string;
  investmentId: string;
  senderUserId: string;
}): Promise<
  | { ok: true; sentTo: string }
  | { ok: false; status: number; message: string }
> {
  const line = await findDistributionPaymentLine(params);
  if (!line) {
    return {
      ok: false,
      status: 404,
      message: "Investor not found on this distribution.",
    };
  }
  const dealId = params.dealId.trim();

  const details = await getDistributionInvestmentBankAccountDetails(params);
  if (details?.status === "set_up") {
    return {
      ok: false,
      status: 409,
      message: "This investor already has a bank account set up.",
    };
  }

  const recipient = await resolveInvestorRecipient({
    dealId,
    investmentId: line.investmentId,
  });
  if (!recipient) {
    return {
      ok: false,
      status: 422,
      message: "No email address is on file for this investor.",
    };
  }

  const fromAddress = process.env.SENDER_EMAIL_ID?.trim() || "";
  if (!fromAddress) {
    return {
      ok: false,
      status: 500,
      message: "Email is not configured (SENDER_EMAIL_ID).",
    };
  }

  const [deal, [sender]] = await Promise.all([
    getAddDealFormById(dealId),
    db
      .select({
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, params.senderUserId))
      .limit(1),
  ]);
  const dealName = deal?.dealName?.trim() || "your investment";
  const lineName = line.investorName === "—" ? "" : line.investorName;
  const templateVars = {
    dealName,
    investorDisplayName: recipient.name || lineName,
    investorEmail: recipient.email,
    senderDisplayName: personName(sender?.firstName, sender?.lastName),
    senderBrand: SENDER_DISPLAY_NAME,
    setupUrl: bankAccountsSetupUrl(),
  };
  const senderEmail = String(sender?.email ?? "").trim();

  try {
    const ccBcc = outgoingMailCcBcc();
    await emailConfig().sendMail({
      from: { name: SENDER_DISPLAY_NAME, address: fromAddress },
      to: recipient.email,
      ...ccBcc,
      ...(senderEmail.includes("@") ? { replyTo: senderEmail } : {}),
      envelope: smtpEnvelopeForSendMail({
        fromAddress,
        to: recipient.email,
        cc: ccBcc.cc,
        bcc: ccBcc.bcc,
      }),
      subject: `Set up your bank account — ${dealName}`,
      text: buildBankAccountSetupRequestEmailText(templateVars),
      html: buildBankAccountSetupRequestEmailHtml(templateVars),
    });
  } catch (err) {
    console.error("sendBankAccountSetupRequestEmail:", err);
    return {
      ok: false,
      status: 502,
      message: "Could not send the email. Please try again.",
    };
  }
  return { ok: true, sentTo: recipient.email };
}
