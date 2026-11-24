ALTER TABLE "investor_distribution_payouts"
  ADD COLUMN IF NOT EXISTS "stripe_funding_topup_id" varchar(255);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "investor_distribution_payouts_funding_topup_uidx"
  ON "investor_distribution_payouts" ("stripe_funding_topup_id");
