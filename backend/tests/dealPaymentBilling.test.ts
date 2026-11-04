import assert from "node:assert/strict";
import test from "node:test";
import {
  nextBillingDateFromPayment,
  paymentCoversRequiredPackage,
} from "../src/services/billing/dealExtraCompanyUser.service.js";

test("a paid package covers the co-sponsor count that payment bought", () => {
  assert.equal(
    paymentCoversRequiredPackage({
      paidCents: 189_000,
      cycle: "annual",
      planId: "starter",
      seatBand: "10plus",
    }),
    true,
  );
  assert.equal(
    paymentCoversRequiredPackage({
      paidCents: 149_000,
      cycle: "annual",
      planId: "starter",
      seatBand: "10plus",
    }),
    false,
  );
});

test("next billing date is the payment date plus the cycle", () => {
  const paid = new Date("2026-10-16T12:30:04.000Z");
  const now = new Date("2026-11-04T09:00:00.000Z");
  assert.equal(
    nextBillingDateFromPayment(paid, "annual", now)?.toISOString(),
    "2027-10-16T12:30:04.000Z",
  );
  assert.equal(
    nextBillingDateFromPayment(paid, "monthly", now)?.toISOString(),
    "2026-11-16T12:30:04.000Z",
  );
});
