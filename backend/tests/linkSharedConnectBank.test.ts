import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  achBankKey,
  connectLinksForMatchingBanks,
  type ConnectBankLinkProfile,
} from "../src/services/investing/linkSharedConnectBank.js";

function profile(
  patch: Partial<ConnectBankLinkProfile> & Pick<ConnectBankLinkProfile, "id">,
): ConnectBankLinkProfile {
  return {
    archived: false,
    isDraft: false,
    achRoutingNumber: "",
    achAccountNumber: "",
    stripeConnectAccountId: null,
    stripeConnectPayoutsEnabled: false,
    stripeConnectStatus: "not_started",
    stripeConnectDetailsSubmitted: false,
    stripeConnectChargesEnabled: false,
    ...patch,
  };
}

describe("shared Connect bank for the same account details", () => {
  it("matches on routing and account number", () => {
    assert.equal(achBankKey("110000000", "000123456789"), "110000000|000123456789");
    assert.equal(achBankKey("110-000-000", "000123456789"), "110000000|000123456789");
    assert.equal(achBankKey("123", "000123456789"), null);
  });

  it("links a second profile that stores the same bank", () => {
    const links = connectLinksForMatchingBanks(
      [
        profile({
          id: "ready",
          achRoutingNumber: "110000000",
          achAccountNumber: "000123456789",
          stripeConnectAccountId: "acct_ready",
          stripeConnectPayoutsEnabled: true,
          stripeConnectStatus: "ready",
          stripeConnectDetailsSubmitted: true,
        }),
        profile({
          id: "second",
          achRoutingNumber: "110-000000",
          achAccountNumber: "000123456789",
        }),
      ],
      new Set(),
    );
    assert.equal(links.get("second")?.accountId, "acct_ready");
    assert.equal(links.get("second")?.payoutsEnabled, true);
    assert.equal(links.has("ready"), false);
  });

  it("does not replace a profile that already uses a different Stripe account", () => {
    const links = connectLinksForMatchingBanks(
      [
        profile({
          id: "ready",
          achRoutingNumber: "110000000",
          achAccountNumber: "000123456789",
          stripeConnectAccountId: "acct_ready",
          stripeConnectPayoutsEnabled: true,
          stripeConnectStatus: "ready",
        }),
        profile({
          id: "other",
          achRoutingNumber: "110000000",
          achAccountNumber: "000123456789",
          stripeConnectAccountId: "acct_other",
        }),
        profile({
          id: "different-bank",
          achRoutingNumber: "021000021",
          achAccountNumber: "999999999",
        }),
      ],
      new Set(),
    );
    assert.equal(links.has("other"), false);
    assert.equal(links.has("different-bank"), false);
  });
});
