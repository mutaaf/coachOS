-- Operational tables live in the `ops` schema (see 00000_ops_schema.sql).
-- `public` here is the marketing CMS; `extensions` supplies gen_random_uuid().
SET search_path = ops, public, extensions;

-- Stripe integration: add Stripe fields to parents, invoices, and payments

ALTER TABLE parents ADD COLUMN stripe_customer_id text;
ALTER TABLE invoices ADD COLUMN stripe_invoice_id text;
ALTER TABLE invoices ADD COLUMN stripe_hosted_invoice_url text;

-- Expand payment method to include 'stripe'
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'zelle', 'venmo', 'stripe'));

ALTER TABLE parents DROP CONSTRAINT IF EXISTS parents_preferred_payment_check;
ALTER TABLE parents ADD CONSTRAINT parents_preferred_payment_check
  CHECK (preferred_payment IN ('cash', 'zelle', 'venmo', 'stripe'));

-- Config entries for Stripe settings
INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
  ('payments', 'stripe_enabled', 'false', 'Enable Stripe', 'Enable online payments via Stripe', 'toggle', 10),
  ('payments', 'stripe_secret_key', '', 'Stripe Secret Key', 'Starts with sk_', 'text', 11),
  ('payments', 'stripe_webhook_secret', '', 'Webhook Secret', 'Starts with whsec_', 'text', 12)
ON CONFLICT (key) DO NOTHING;

-- Indexes
CREATE INDEX idx_invoices_stripe_id ON invoices (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX idx_parents_stripe_id ON parents (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
