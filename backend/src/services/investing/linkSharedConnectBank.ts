import { eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import { userInvestorProfiles } from "../../schema/schema.js";
import { archivedConnectAccountIds } from "../bankAccounts/investorBankAccountRecords.service.js";

export type ConnectBankLinkProfile = {
  id: string;
  archived: boolean;
  isDraft: boolean;
  achRoutingNumber: string;
  achAccountNumber: string;
  stripeConnectAccountId: string | null;
  stripeConnectPayoutsEnabled: boolean;
  stripeConnectStatus: string;
  stripeConnectDetailsSubmitted: boolean;
  stripeConnectChargesEnabled: boolean;
};

export type ConnectBankLinkSource = {
  accountId: string;
  status: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

/** Same US routing and account number. Bank name is not part of the match. */
export function achBankKey(routing: string, account: string): string | null {
  const routingDigits = routing.replace(/\D/g, "");
  const accountDigits = account.replace(/\D/g, "");
  if (routingDigits.length !== 9 || accountDigits.length < 4 || accountDigits.length > 17) {
    return null;
  }
  return `${routingDigits}|${accountDigits}`;
}

/**
 * Profiles with the same routing and account number reuse a ready Stripe
 * account. A profile that already has a different Stripe account is left alone.
 */
export function connectLinksForMatchingBanks(
  rows: ConnectBankLinkProfile[],
  archivedAccountIds: ReadonlySet<string>,
): Map<string, ConnectBankLinkSource> {
  const readyByKey = new Map<string, ConnectBankLinkSource>();
  for (const row of rows) {
    if (row.archived || row.isDraft || !row.stripeConnectPayoutsEnabled) continue;
    const accountId = row.stripeConnectAccountId?.trim() || "";
    if (!accountId || archivedAccountIds.has(accountId)) continue;
    const key = achBankKey(row.achRoutingNumber, row.achAccountNumber);
    if (!key || readyByKey.has(key)) continue;
    readyByKey.set(key, {
      accountId,
      status: row.stripeConnectStatus,
      detailsSubmitted: row.stripeConnectDetailsSubmitted,
      chargesEnabled: row.stripeConnectChargesEnabled,
      payoutsEnabled: true,
    });
  }

  const links = new Map<string, ConnectBankLinkSource>();
  for (const row of rows) {
    if (row.archived || row.isDraft) continue;
    const key = achBankKey(row.achRoutingNumber, row.achAccountNumber);
    const source = key ? readyByKey.get(key) : undefined;
    if (!source) continue;
    const current = row.stripeConnectAccountId?.trim() || "";
    if (current && current !== source.accountId) continue;
    if (current === source.accountId && row.stripeConnectPayoutsEnabled) continue;
    links.set(row.id, source);
  }
  return links;
}

/** Copy a ready Connect account onto this user's profiles that store the same bank. */
export async function linkProfilesSharingReadyConnectBank(
  userId: string,
): Promise<number> {
  const rows = await db
    .select({
      id: userInvestorProfiles.id,
      archived: userInvestorProfiles.archived,
      isDraft: userInvestorProfiles.isDraft,
      achRoutingNumber: userInvestorProfiles.achRoutingNumber,
      achAccountNumber: userInvestorProfiles.achAccountNumber,
      stripeConnectAccountId: userInvestorProfiles.stripeConnectAccountId,
      stripeConnectPayoutsEnabled: userInvestorProfiles.stripeConnectPayoutsEnabled,
      stripeConnectStatus: userInvestorProfiles.stripeConnectStatus,
      stripeConnectDetailsSubmitted: userInvestorProfiles.stripeConnectDetailsSubmitted,
      stripeConnectChargesEnabled: userInvestorProfiles.stripeConnectChargesEnabled,
    })
    .from(userInvestorProfiles)
    .where(eq(userInvestorProfiles.userId, userId));

  const archived = await archivedConnectAccountIds(userId);
  const links = connectLinksForMatchingBanks(rows, archived);
  if (links.size === 0) return 0;

  const byAccount = new Map<string, string[]>();
  for (const [profileId, source] of links) {
    const ids = byAccount.get(source.accountId) ?? [];
    ids.push(profileId);
    byAccount.set(source.accountId, ids);
  }

  let updated = 0;
  for (const [accountId, profileIds] of byAccount) {
    const source = [...links.values()].find((row) => row.accountId === accountId);
    if (!source) continue;
    const result = await db
      .update(userInvestorProfiles)
      .set({
        stripeConnectAccountId: source.accountId,
        stripeConnectStatus: source.status,
        stripeConnectDetailsSubmitted: source.detailsSubmitted,
        stripeConnectChargesEnabled: source.chargesEnabled,
        stripeConnectPayoutsEnabled: source.payoutsEnabled,
        stripeConnectUpdatedAt: new Date(),
      })
      .where(inArray(userInvestorProfiles.id, profileIds))
      .returning({ id: userInvestorProfiles.id });
    updated += result.length;
  }
  return updated;
}
