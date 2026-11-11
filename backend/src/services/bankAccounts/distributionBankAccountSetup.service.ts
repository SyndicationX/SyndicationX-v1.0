import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import { addDealForm } from "../../schema/deal.schema/add-deal-form.schema.js";
import {
  dealInvestment,
  investorDistributionPayouts,
  userInvestorProfiles,
} from "../../schema/schema.js";
import { parseDistributionSetupDocument } from "../distributionSetup/distributionSetup.mapper.js";
import {
  distributionBankFromDbRow,
  distributionBankFromFormSnapshot,
} from "../investing/investorProfileDistributionBank.js";
import { resolveConnectBankAccountSummary } from "../payments/connectBankAccountSummary.js";
import { maskKeepLast4 } from "./bankAccountAudit.js";
import {
  listActiveBankAccountsForUsers,
  PROFILE_BANK_RECORD_PREFIX,
} from "./investorBankAccountRecords.service.js";
import {
  isEligibleActiveBankAccount,
  resolveBankAccountForSetup,
  resolveBankAccountSetupStatus,
  type BankAccountSetupStatus,
} from "./bankAccountSetup.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DistributionBankAccountSetupLine = {
  investmentId: string;
  status: BankAccountSetupStatus;
};

function uuid(value: string): string | null {
  const t = value.trim();
  return UUID_RE.test(t) ? t : null;
}

async function distributionPaymentLines(
  dealId: string,
  distributionId: string,
): Promise<{ investmentId: string; investorName: string }[]> {
  const [deal] = await db
    .select({
      distributionSetupJson: addDealForm.distributionSetupJson,
    })
    .from(addDealForm)
    .where(eq(addDealForm.id, dealId))
    .limit(1);
  const parsed = parseDistributionSetupDocument(
    deal?.distributionSetupJson ?? "{}",
  );
  const prior = (parsed.priorDistributions ?? []).find(
    (row) => row.id === distributionId,
  );
  return (prior?.investorPayments ?? []).flatMap((line) => {
    const investmentId = uuid(String(line.investorId ?? ""));
    if (!investmentId) return [];
    return [
      { investmentId, investorName: String(line.investorName ?? "").trim() },
    ];
  });
}

async function distributionInvestmentIds(
  dealId: string,
  distributionId: string,
): Promise<string[]> {
  const lines = await distributionPaymentLines(dealId, distributionId);
  return [...new Set(lines.map((line) => line.investmentId))];
}

/** The payment line for one investment on a completed distribution, if present. */
export async function findDistributionPaymentLine(params: {
  dealId: string;
  distributionId: string;
  investmentId: string;
}): Promise<{ investmentId: string; investorName: string } | null> {
  const dealId = uuid(params.dealId);
  const investmentId = uuid(params.investmentId);
  const distributionId = params.distributionId.trim();
  if (!dealId || !investmentId || !distributionId) return null;
  const lines = await distributionPaymentLines(dealId, distributionId);
  return lines.find((line) => line.investmentId === investmentId) ?? null;
}

/**
 * Per investment line: Set Up when an eligible active bank account is on file.
 * A payout already tied to one account checks that account only.
 */
export async function listDistributionBankAccountSetup(params: {
  dealId: string;
  distributionId: string;
}): Promise<DistributionBankAccountSetupLine[]> {
  const dealId = uuid(params.dealId);
  const distributionId = params.distributionId.trim();
  if (!dealId || !distributionId) return [];

  const investmentIds = await distributionInvestmentIds(dealId, distributionId);
  if (investmentIds.length === 0) return [];

  const [investments, payouts] = await Promise.all([
    db
      .select({
        id: dealInvestment.id,
        profileId: dealInvestment.userInvestorProfileId,
        investorUserId: userInvestorProfiles.userId,
      })
      .from(dealInvestment)
      .leftJoin(
        userInvestorProfiles,
        eq(userInvestorProfiles.id, dealInvestment.userInvestorProfileId),
      )
      .where(
        and(
          eq(dealInvestment.dealId, dealId),
          inArray(dealInvestment.id, investmentIds),
        ),
      ),
    db
      .select({
        investmentId: investorDistributionPayouts.investmentId,
        accountId: investorDistributionPayouts.stripeConnectedAccountId,
        investorUserId: investorDistributionPayouts.investorUserId,
        profileId: investorDistributionPayouts.userInvestorProfileId,
      })
      .from(investorDistributionPayouts)
      .where(
        and(
          eq(investorDistributionPayouts.dealId, dealId),
          eq(investorDistributionPayouts.distributionId, distributionId),
          inArray(investorDistributionPayouts.investmentId, investmentIds),
        ),
      ),
  ]);

  const userIds = [
    ...investments.map((row) => row.investorUserId),
    ...payouts.map((row) => row.investorUserId),
  ].filter((id): id is string => Boolean(id));
  const accountsByUser = await listActiveBankAccountsForUsers(userIds);
  const investmentById = new Map(investments.map((row) => [row.id, row]));
  const payoutByInvestment = new Map(
    payouts.map((row) => [row.investmentId, row]),
  );

  return investmentIds.map((investmentId) => {
    const investment = investmentById.get(investmentId);
    const payout = payoutByInvestment.get(investmentId);
    const userId = investment?.investorUserId || payout?.investorUserId || "";
    const profileId = investment?.profileId || payout?.profileId || "";
    const accounts = userId ? (accountsByUser.get(userId) ?? []) : [];
    const associatedAccountId = payout?.accountId?.trim() || null;
    return {
      investmentId,
      status: resolveBankAccountSetupStatus({
        accounts,
        associatedAccountId,
        profileId,
      }),
    };
  });
}

export type DistributionBankAccountDetail = {
  source: "stripe_connect" | "saved_profile";
  bankName: string | null;
  accountHolderName: string | null;
  /** Masked, e.g. ••••1234. Full numbers are never returned. */
  accountNumberMasked: string | null;
  routingNumberMasked: string | null;
  accountType: string | null;
  connectStatus: string | null;
  payoutsEnabled: boolean;
  detailsPresent: boolean;
};

export type DistributionBankAccountDetails = {
  investmentId: string;
  status: BankAccountSetupStatus;
  investorProfileName: string | null;
  /** The one account this deal's distribution line pays to, if any. */
  account: DistributionBankAccountDetail | null;
};

function maskedOrNull(value: string | null | undefined): string | null {
  return maskKeepLast4(value) || null;
}

/**
 * The one bank account behind a line's Set Up badge — the same account
 * {@link resolveBankAccountForSetup} picks for {@link listDistributionBankAccountSetup}.
 * The investor's other accounts are not returned.
 * Returns null when the investment is not on this distribution.
 */
export async function getDistributionInvestmentBankAccountDetails(params: {
  dealId: string;
  distributionId: string;
  investmentId: string;
}): Promise<DistributionBankAccountDetails | null> {
  const dealId = uuid(params.dealId);
  const investmentId = uuid(params.investmentId);
  const distributionId = params.distributionId.trim();
  if (!dealId || !investmentId || !distributionId) return null;

  const lineIds = await distributionInvestmentIds(dealId, distributionId);
  if (!lineIds.includes(investmentId)) return null;

  const [[investment], [payout]] = await Promise.all([
    db
      .select({
        profileId: dealInvestment.userInvestorProfileId,
        investorUserId: userInvestorProfiles.userId,
      })
      .from(dealInvestment)
      .leftJoin(
        userInvestorProfiles,
        eq(userInvestorProfiles.id, dealInvestment.userInvestorProfileId),
      )
      .where(
        and(
          eq(dealInvestment.dealId, dealId),
          eq(dealInvestment.id, investmentId),
        ),
      )
      .limit(1),
    db
      .select({
        accountId: investorDistributionPayouts.stripeConnectedAccountId,
        investorUserId: investorDistributionPayouts.investorUserId,
        profileId: investorDistributionPayouts.userInvestorProfileId,
      })
      .from(investorDistributionPayouts)
      .where(
        and(
          eq(investorDistributionPayouts.dealId, dealId),
          eq(investorDistributionPayouts.distributionId, distributionId),
          eq(investorDistributionPayouts.investmentId, investmentId),
        ),
      )
      .limit(1),
  ]);

  const userId = investment?.investorUserId || payout?.investorUserId || "";
  const profileId = investment?.profileId || payout?.profileId || "";
  const associatedAccountId = payout?.accountId?.trim() || null;
  if (!userId) {
    return {
      investmentId,
      status: "not_set_up",
      investorProfileName: null,
      account: null,
    };
  }

  const accountsByUser = await listActiveBankAccountsForUsers([userId]);
  const presence = accountsByUser.get(userId) ?? [];
  const used = resolveBankAccountForSetup({
    accounts: presence,
    associatedAccountId,
    profileId,
  });
  const usedProfileIds = used?.profileIds ?? [];
  const sourceProfileId = used?.id.startsWith(PROFILE_BANK_RECORD_PREFIX)
    ? used.id.slice(PROFILE_BANK_RECORD_PREFIX.length)
    : profileId && usedProfileIds.includes(profileId)
      ? profileId
      : (usedProfileIds[0] ?? "");
  const profileIdsToLoad = [
    ...new Set([profileId, sourceProfileId].filter(Boolean)),
  ];

  const profileRows =
    profileIdsToLoad.length > 0
      ? await db
          .select({
            id: userInvestorProfiles.id,
            profileName: userInvestorProfiles.profileName,
            status: userInvestorProfiles.stripeConnectStatus,
            payoutsEnabled: userInvestorProfiles.stripeConnectPayoutsEnabled,
            distributionMethod: userInvestorProfiles.distributionMethod,
            achRoutingNumber: userInvestorProfiles.achRoutingNumber,
            achAccountNumber: userInvestorProfiles.achAccountNumber,
            achBankAddress: userInvestorProfiles.achBankAddress,
            achBankName: userInvestorProfiles.achBankName,
            achBankAccountType: userInvestorProfiles.achBankAccountType,
            bankAccountQuery: userInvestorProfiles.bankAccountQuery,
            checkPayeeName: userInvestorProfiles.checkPayeeName,
            checkMailingAddressId: userInvestorProfiles.checkMailingAddressId,
            formSnapshot: userInvestorProfiles.formSnapshot,
          })
          .from(userInvestorProfiles)
          .where(
            and(
              inArray(userInvestorProfiles.id, profileIdsToLoad),
              eq(userInvestorProfiles.userId, userId),
            ),
          )
      : [];
  const lineProfile = profileRows.find((row) => row.id === profileId);
  const sourceProfile = profileRows.find((row) => row.id === sourceProfileId);

  let account: DistributionBankAccountDetail | null = null;
  if (used?.id.startsWith(PROFILE_BANK_RECORD_PREFIX)) {
    const fromDb = sourceProfile ? distributionBankFromDbRow(sourceProfile) : null;
    const fromSnapshot = distributionBankFromFormSnapshot(
      sourceProfile?.formSnapshot ?? null,
    );
    account = {
      source: "saved_profile",
      bankName: fromDb?.achBankName || fromSnapshot.achBankName || null,
      accountHolderName: null,
      accountNumberMasked: maskedOrNull(
        fromDb?.achAccountNumber || fromSnapshot.achAccountNumber,
      ),
      routingNumberMasked: maskedOrNull(
        fromDb?.achRoutingNumber || fromSnapshot.achRoutingNumber,
      ),
      accountType:
        fromDb?.achBankAccountType || fromSnapshot.achBankAccountType || null,
      connectStatus: null,
      payoutsEnabled: false,
      detailsPresent: isEligibleActiveBankAccount(used),
    };
  } else if (used) {
    let summary: Awaited<
      ReturnType<typeof resolveConnectBankAccountSummary>
    > = null;
    try {
      summary = await resolveConnectBankAccountSummary({ accountId: used.id });
    } catch (err) {
      console.error("getDistributionInvestmentBankAccountDetails:", err);
    }
    account = {
      source: "stripe_connect",
      bankName: summary?.bankName ?? null,
      accountHolderName: summary?.accountHolderName ?? null,
      accountNumberMasked: maskedOrNull(summary?.last4),
      routingNumberMasked: maskedOrNull(summary?.routingNumber),
      accountType: null,
      connectStatus: sourceProfile?.status?.trim() || null,
      payoutsEnabled: Boolean(sourceProfile?.payoutsEnabled),
      detailsPresent: isEligibleActiveBankAccount(used),
    };
  }

  return {
    investmentId,
    status: used ? "set_up" : "not_set_up",
    investorProfileName:
      lineProfile?.profileName?.trim() ||
      sourceProfile?.profileName?.trim() ||
      null,
    account,
  };
}
