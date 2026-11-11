/**
 * Bank Account Setup is a presence check only.
 * It does not mean the account is verified or that ACH payouts are enabled.
 */
export type BankAccountSetupStatus = "set_up" | "not_set_up";

export type BankAccountPresence = {
  /** Stable bank-account record id (Connect account id). */
  id: string;
  deleted?: boolean;
  /** True when bank account details are on file. */
  detailsPresent: boolean;
  /** Investor profiles that currently use this account. */
  profileIds?: string[];
};

export function isEligibleActiveBankAccount(
  account: BankAccountPresence,
): boolean {
  if (account.deleted) return false;
  if (!account.id.trim()) return false;
  return account.detailsPresent;
}

/**
 * Local signals that bank details exist. Payouts-enabled is used only as
 * evidence that a bank record is on file, not as an ACH or verification flag.
 */
/** Bank details saved on an investor profile (wizard / ACH columns). */
export function savedProfileBankDetailsPresent(input: {
  achBankName?: string | null;
  achRoutingNumber?: string | null;
  achAccountNumber?: string | null;
}): boolean {
  const name = String(input.achBankName ?? "").trim();
  const routing = String(input.achRoutingNumber ?? "").replace(/\D/g, "");
  const account = String(input.achAccountNumber ?? "").replace(/\D/g, "");
  return Boolean((name && (routing || account)) || (routing && account));
}

export function bankDetailsArePresent(input: {
  accountId?: string | null;
  detailsSubmitted?: boolean;
  payoutsEnabled?: boolean;
  status?: string | null;
}): boolean {
  if (!String(input.accountId ?? "").trim()) return false;
  if (input.detailsSubmitted) return true;
  if (input.payoutsEnabled) return true;
  const status = String(input.status ?? "").trim().toLowerCase();
  return (
    status === "ready" ||
    status === "linked" ||
    status === "pending" ||
    status === "restricted"
  );
}

type ResolveBankAccountSetupParams = {
  accounts: BankAccountPresence[];
  /**
   * When a distribution line is tied to one bank account, only that account
   * counts. A different active account on the investor does not substitute.
   */
  associatedAccountId?: string | null;
  /** Limit the investor-level check to accounts used by this profile. */
  profileId?: string | null;
};

/** The bank account that makes a line Set Up, or null when Not Set Up. */
export function resolveBankAccountForSetup(
  params: ResolveBankAccountSetupParams,
): BankAccountPresence | null {
  const eligible = params.accounts.filter(isEligibleActiveBankAccount);
  const associated = String(params.associatedAccountId ?? "").trim();
  if (associated) {
    const match = eligible.find((account) => account.id.trim() === associated);
    if (match) return match;
  }

  const profileId = String(params.profileId ?? "").trim();
  if (profileId) {
    const onProfile = eligible.find((account) =>
      (account.profileIds ?? []).some((id) => id === profileId),
    );
    if (onProfile) return onProfile;
  }
  // Banks saved on this investor's other profiles.
  return eligible[0] ?? null;
}

export function resolveBankAccountSetupStatus(
  params: ResolveBankAccountSetupParams,
): BankAccountSetupStatus {
  return resolveBankAccountForSetup(params) ? "set_up" : "not_set_up";
}
