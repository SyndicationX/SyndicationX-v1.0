import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInvestorConnectBankPrefill,
  buildInvestorConnectIdentity,
  e164UsPhone,
  type InvestorConnectPrefillSource,
} from "../src/services/payments/investorConnectOnboardingPrefill.js";

function source(
  patch: Partial<InvestorConnectPrefillSource> = {},
): InvestorConnectPrefillSource {
  return {
    profileName: "Ada Lovelace",
    profileType: "Individual",
    userFirstName: "Ada",
    userLastName: "Lovelace",
    userEmail: "ada@example.com",
    userPhone: "4155550100",
    formSnapshot: {
      profileType: "Individual",
      firstName: "Ada",
      lastName: "Lovelace",
      email1: "ada@example.com",
      ssn: "123-45-6789",
    },
    achRoutingNumber: "110000000",
    achAccountNumber: "000123456789",
    address: {
      street1: "1 Market St",
      street2: "Suite 2",
      city: "San Francisco",
      state: "California",
      zip: "94105",
      country: "United States",
    },
    ...patch,
  };
}

describe("investor Connect onboarding prefill", () => {
  it("formats a US phone as E.164", () => {
    assert.equal(e164UsPhone("(415) 555-0100"), "+14155550100");
    assert.equal(e164UsPhone("not-a-phone"), null);
  });

  it("builds an individual identity from the saved profile", () => {
    const identity = buildInvestorConnectIdentity(source());
    assert.equal(identity?.entity_type, "individual");
    assert.equal(identity?.individual?.given_name, "Ada");
    assert.equal(identity?.individual?.surname, "Lovelace");
    assert.equal(identity?.individual?.phone, "+14155550100");
    assert.equal(identity?.individual?.address?.state, "CA");
    assert.deepEqual(identity?.individual?.id_numbers, [
      { type: "us_ssn", value: "123456789" },
    ]);
  });

  it("builds a company identity and bank holder from an entity profile", () => {
    const entity = source({
      profileName: "Northwind LLC",
      profileType: "Entity",
      formSnapshot: {
        profileType: "Entity",
        entitySubType: "llc",
        entityLegalName: "Northwind LLC",
        entityEin: "12-3456789",
        entityMemberCount: "3",
      },
    });
    const identity = buildInvestorConnectIdentity(entity);
    assert.equal(identity?.entity_type, "company");
    assert.equal(identity?.business_details?.registered_name, "Northwind LLC");
    assert.equal(identity?.business_details?.structure, "multi_member_llc");
    assert.deepEqual(identity?.business_details?.id_numbers, [
      { type: "us_ein", value: "123456789" },
    ]);
    const bank = buildInvestorConnectBankPrefill(entity);
    assert.equal(bank?.holderType, "company");
    assert.equal(bank?.accountHolderName, "Northwind LLC");
    assert.equal(bank?.routingNumber, "110000000");
  });

  it("skips a bank prefill when the routing number is incomplete", () => {
    assert.equal(
      buildInvestorConnectBankPrefill(source({ achRoutingNumber: "123" })),
      null,
    );
  });
});
