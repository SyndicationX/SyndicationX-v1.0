import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../database/db.js";
import {
  userInvestorProfiles,
  userSavedAddresses,
  users,
} from "../../schema/schema.js";
import { V2_ACCOUNT_INCLUDE } from "./connectV2AccountConfig.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const US_STATE_CODES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

export type InvestorConnectPrefillSource = {
  profileName: string;
  profileType: string;
  userFirstName: string;
  userLastName: string;
  userEmail: string;
  userPhone: string;
  formSnapshot: Record<string, unknown> | null;
  achRoutingNumber: string;
  achAccountNumber: string;
  address: {
    street1: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  } | null;
};

export type InvestorConnectBankPrefill = {
  routingNumber: string;
  accountNumber: string;
  accountHolderName: string;
  holderType: "individual" | "company";
};

type StripeIdentity = Stripe.V2.Core.AccountCreateParams.Identity;

function snap(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function usStateCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return US_STATE_CODES[value.toLowerCase()] ?? null;
}

export function e164UsPhone(raw: string): string | null {
  const value = digits(raw);
  if (value.length === 10) return `+1${value}`;
  if (value.length === 11 && value.startsWith("1")) return `+${value}`;
  return null;
}

function isEntityProfile(profileType: string, snapshot: Record<string, unknown> | null): boolean {
  const type = `${profileType} ${snap(snapshot, "profileType")}`.toLowerCase();
  return (
    type.includes("entity") ||
    type.includes("llc") ||
    type.includes("corp") ||
    type.includes("partnership") ||
    type.includes("trust") ||
    type.includes("ira") ||
    type.includes("401")
  );
}

function personName(source: InvestorConnectPrefillSource): {
  givenName: string;
  surname: string;
} {
  const snapshot = source.formSnapshot;
  const givenName =
    snap(snapshot, "firstName") || source.userFirstName.trim();
  const surname = snap(snapshot, "lastName") || source.userLastName.trim();
  if (givenName && surname) return { givenName, surname };
  const parts = source.profileName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      givenName: givenName || parts[0]!,
      surname: surname || parts.slice(1).join(" "),
    };
  }
  return { givenName, surname };
}

function addressForStripe(
  address: InvestorConnectPrefillSource["address"],
): { line1: string; line2?: string; city?: string; state: string; postal_code?: string; country: "US" } | null {
  if (!address) return null;
  const countryRaw = address.country.trim().toLowerCase();
  const looksUs =
    !countryRaw ||
    countryRaw === "us" ||
    countryRaw === "usa" ||
    countryRaw === "united states" ||
    countryRaw === "united states of america";
  if (!looksUs) return null;
  const line1 = address.street1.trim();
  const state = usStateCode(address.state);
  if (!line1 || !state) return null;
  const line2 = address.street2.trim();
  const city = address.city.trim();
  const postal = address.zip.trim();
  return {
    line1: line1.slice(0, 200),
    ...(line2 ? { line2: line2.slice(0, 200) } : {}),
    ...(city ? { city: city.slice(0, 100) } : {}),
    state,
    ...(postal ? { postal_code: postal.slice(0, 20) } : {}),
    country: "US",
  };
}

function individualTaxId(raw: string): { type: "us_ssn" | "us_itin" | "us_ssn_last_4"; value: string } | null {
  const value = digits(raw);
  if (value.length === 4) return { type: "us_ssn_last_4", value };
  if (value.length !== 9) return null;
  const itin = value.startsWith("9");
  return { type: itin ? "us_itin" : "us_ssn", value };
}

function businessStructure(
  snapshot: Record<string, unknown> | null,
): Stripe.V2.Core.AccountCreateParams.Identity.BusinessDetails.Structure | null {
  const sub = snap(snapshot, "entitySubType").toLowerCase();
  const tax = snap(snapshot, "federalTaxClassification").toLowerCase();
  if (sub === "trust" || tax === "trust_estate") return "trust";
  if (sub === "partnership" || tax === "partnership") return "private_partnership";
  if (sub === "corporation" || tax === "c_corp" || tax === "s_corp") {
    return "private_corporation";
  }
  if (sub === "llc" || tax.includes("llc") || tax === "individual_sole_smllc") {
    const members = Number(snap(snapshot, "entityMemberCount"));
    const disregarded = snap(snapshot, "entityDisregarded").toLowerCase() === "yes";
    if (disregarded || members === 1 || tax === "individual_sole_smllc") {
      return "single_member_llc";
    }
    return "multi_member_llc";
  }
  return null;
}

/** Identity fields Stripe Accounts v2 accepts from data already stored on the profile. */
export function buildInvestorConnectIdentity(
  source: InvestorConnectPrefillSource,
): StripeIdentity | null {
  const snapshot = source.formSnapshot;
  const address = addressForStripe(source.address);
  const phone = e164UsPhone(source.userPhone);
  const email = snap(snapshot, "email1") || source.userEmail.trim();

  if (isEntityProfile(source.profileType, snapshot)) {
    const registered =
      snap(snapshot, "entityLegalName") ||
      snap(snapshot, "legalIraName") ||
      source.profileName.trim();
    const ein = digits(snap(snapshot, "entityEin") || snap(snapshot, "iraCustodianEin"));
    const structure = businessStructure(snapshot);
    const business: Stripe.V2.Core.AccountCreateParams.Identity.BusinessDetails = {};
    if (registered) business.registered_name = registered.slice(0, 200);
    if (address) business.address = address;
    if (phone) business.phone = phone;
    if (ein.length === 9) business.id_numbers = [{ type: "us_ein", value: ein }];
    if (structure) business.structure = structure;
    if (!business.registered_name && !business.address && !business.id_numbers) {
      return null;
    }
    return { country: "us", entity_type: "company", business_details: business };
  }

  const { givenName, surname } = personName(source);
  const taxId = individualTaxId(snap(snapshot, "ssn"));
  const individual: NonNullable<StripeIdentity["individual"]> = {};
  if (givenName) individual.given_name = givenName.slice(0, 100);
  if (surname) individual.surname = surname.slice(0, 100);
  if (email.includes("@")) individual.email = email.slice(0, 200);
  if (phone) individual.phone = phone;
  if (address) individual.address = address;
  if (taxId) individual.id_numbers = [taxId];
  if (!individual.given_name && !individual.surname && !individual.address && !individual.id_numbers) {
    return null;
  }
  return { country: "us", entity_type: "individual", individual };
}

export function buildInvestorConnectBankPrefill(
  source: InvestorConnectPrefillSource,
): InvestorConnectBankPrefill | null {
  const snapshot = source.formSnapshot;
  const routing = digits(
    source.achRoutingNumber || snap(snapshot, "achRoutingNumber"),
  );
  const account = digits(
    source.achAccountNumber || snap(snapshot, "achAccountNumber"),
  );
  if (routing.length !== 9 || account.length < 4 || account.length > 17) return null;
  const entity = isEntityProfile(source.profileType, snapshot);
  const { givenName, surname } = personName(source);
  const holder = entity
    ? snap(snapshot, "entityLegalName") || source.profileName.trim()
    : [givenName, surname].filter(Boolean).join(" ") || source.profileName.trim();
  return {
    routingNumber: routing,
    accountNumber: account,
    accountHolderName: (holder || "Investor").slice(0, 100),
    holderType: entity ? "company" : "individual",
  };
}

export function stripePrefillErrorSummary(err: unknown): string {
  if (err && typeof err === "object") {
    const row = err as { code?: unknown; param?: unknown; message?: unknown };
    const code = typeof row.code === "string" ? row.code : "";
    const param = typeof row.param === "string" ? row.param : "";
    const message = typeof row.message === "string" ? row.message : "";
    return [code, param, message].filter(Boolean).join(" ").slice(0, 300);
  }
  return "unknown";
}

export async function loadInvestorConnectPrefillSource(params: {
  profileId: string;
  userId: string;
}): Promise<InvestorConnectPrefillSource | null> {
  const [row] = await db
    .select({
      profileName: userInvestorProfiles.profileName,
      profileType: userInvestorProfiles.profileType,
      formSnapshot: userInvestorProfiles.formSnapshot,
      achRoutingNumber: userInvestorProfiles.achRoutingNumber,
      achAccountNumber: userInvestorProfiles.achAccountNumber,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      userPhone: users.phone,
    })
    .from(userInvestorProfiles)
    .innerJoin(users, eq(users.id, userInvestorProfiles.userId))
    .where(
      and(
        eq(userInvestorProfiles.id, params.profileId),
        eq(userInvestorProfiles.userId, params.userId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const snapshot =
    row.formSnapshot && typeof row.formSnapshot === "object"
      ? row.formSnapshot
      : null;
  const addressId = snap(snapshot, "taxAddressId");
  let address: InvestorConnectPrefillSource["address"] = null;
  if (UUID_RE.test(addressId)) {
    const [saved] = await db
      .select({
        street1: userSavedAddresses.street1,
        street2: userSavedAddresses.street2,
        city: userSavedAddresses.city,
        state: userSavedAddresses.state,
        zip: userSavedAddresses.zip,
        country: userSavedAddresses.country,
      })
      .from(userSavedAddresses)
      .where(
        and(
          eq(userSavedAddresses.id, addressId),
          eq(userSavedAddresses.userId, params.userId),
        ),
      )
      .limit(1);
    if (saved) address = saved;
  }

  return {
    profileName: row.profileName,
    profileType: row.profileType,
    userFirstName: row.userFirstName,
    userLastName: row.userLastName,
    userEmail: row.userEmail,
    userPhone: row.userPhone,
    formSnapshot: snapshot,
    achRoutingNumber: row.achRoutingNumber,
    achAccountNumber: row.achAccountNumber,
    address,
  };
}

/**
 * Copy stored profile identity onto the Connect account when Stripe has not
 * recorded an entity type yet. Failures stay on the hosted onboarding path.
 */
export async function prefillInvestorConnectIdentity(params: {
  stripe: Stripe;
  accountId: string;
  entityType: string | null | undefined;
  identity: StripeIdentity | null;
}): Promise<void> {
  if (!params.identity || params.entityType) return;
  try {
    await params.stripe.v2.core.accounts.update(params.accountId, {
      identity: params.identity,
      include: [...V2_ACCOUNT_INCLUDE],
    });
  } catch (err) {
    console.error(
      "Investor Connect identity prefill skipped:",
      stripePrefillErrorSummary(err),
    );
  }
}

const EXTERNAL_BANK_API_VERSION = "2026-10-28.preview";

/**
 * Stripe only lets the platform write a routing and account number when the
 * platform collects requirements (`dashboard: "none"`). Express accounts reject
 * that call, which leaves the hosted bank form blank.
 */
export async function ensureInvestorConnectAcceptsPlatformBank(params: {
  stripe: Stripe;
  accountId: string;
  dashboard: string | null | undefined;
}): Promise<void> {
  if (params.dashboard === "none") return;
  await params.stripe.v2.core.accounts.update(params.accountId, {
    dashboard: "none",
    include: [...V2_ACCOUNT_INCLUDE],
  });
}

/**
 * Save the profile ACH account on the connected account before hosted onboarding.
 * Stripe does not echo the full number into the form; once this succeeds, the
 * bank requirement is already satisfied.
 */
export async function prefillInvestorConnectBank(params: {
  stripe: Stripe;
  accountId: string;
  dashboard: string | null | undefined;
  bank: InvestorConnectBankPrefill | null;
}): Promise<void> {
  if (!params.bank) return;
  try {
    await ensureInvestorConnectAcceptsPlatformBank({
      stripe: params.stripe,
      accountId: params.accountId,
      dashboard: params.dashboard,
    });
    const listed = await params.stripe.accounts.listExternalAccounts(
      params.accountId,
      { object: "bank_account", limit: 1 },
      { apiVersion: EXTERNAL_BANK_API_VERSION },
    );
    if (listed.data.length > 0) return;
    await params.stripe.accounts.createExternalAccount(
      params.accountId,
      {
        default_for_currency: true,
        external_account: {
          object: "bank_account",
          country: "US",
          currency: "usd",
          routing_number: params.bank.routingNumber,
          account_number: params.bank.accountNumber,
          account_holder_name: params.bank.accountHolderName,
          account_holder_type: params.bank.holderType,
        },
      },
      {
        idempotencyKey: `investor_connect_bank_${params.accountId}`,
        apiVersion: EXTERNAL_BANK_API_VERSION,
      },
    );
  } catch (err) {
    console.error(
      "Investor Connect bank prefill skipped:",
      stripePrefillErrorSummary(err),
    );
  }
}
