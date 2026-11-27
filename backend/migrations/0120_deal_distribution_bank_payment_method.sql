-- Deal distribution bank is a platform ACH payment method, not a Connect account.
ALTER TABLE "add_deal_form"
  ADD COLUMN IF NOT EXISTS "stripe_distribution_funding_customer_id" text,
  ADD COLUMN IF NOT EXISTS "stripe_distribution_funding_payment_method_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "add_deal_form_stripe_dist_funding_pm_idx"
  ON "add_deal_form" ("stripe_distribution_funding_payment_method_id")
  WHERE "stripe_distribution_funding_payment_method_id" IS NOT NULL;
