-- Who started the Stripe payment. Lead sponsor is not copied here unless they paid.
ALTER TABLE public.company_billing_invoices
  ADD COLUMN IF NOT EXISTS payer_user_id uuid;
