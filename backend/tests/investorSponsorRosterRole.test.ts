import assert from "node:assert/strict";
import test from "node:test";
import { sponsorRoleForNewGeneralPartner } from "../src/services/deal/dealInvestorSponsor.service.js";

test("a new sponsor keeps the previous sponsor's General Partners role", () => {
  assert.equal(
    sponsorRoleForNewGeneralPartner({
      previousRoles: ["admin sponsor"],
      nextAlreadyOnRoster: false,
    }),
    "admin sponsor",
  );
  assert.equal(
    sponsorRoleForNewGeneralPartner({
      previousRoles: ["Co-sponsor"],
      nextAlreadyOnRoster: false,
    }),
    "Co-sponsor",
  );
  assert.equal(
    sponsorRoleForNewGeneralPartner({
      previousRoles: ["co_sponsor", "Admin Sponsor"],
      nextAlreadyOnRoster: false,
    }),
    "admin sponsor",
  );
});

test("someone already on General Partners keeps their current role", () => {
  assert.equal(
    sponsorRoleForNewGeneralPartner({
      previousRoles: ["admin sponsor"],
      nextAlreadyOnRoster: true,
    }),
    null,
  );
});

test("a lead sponsor's replacement is added as an admin sponsor", () => {
  assert.equal(
    sponsorRoleForNewGeneralPartner({
      previousRoles: ["Lead Sponsor"],
      nextAlreadyOnRoster: false,
    }),
    "admin sponsor",
  );
});
