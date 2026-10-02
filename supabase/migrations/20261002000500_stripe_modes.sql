-- ============================================================================
-- Stripe in test mode and live mode, switchable from Settings.
--
-- Everything is tested in Stripe's sandbox before real money moves, and it
-- must be possible to go back to the sandbox to test again. So both sets of
-- keys are kept, and one setting says which is in use.
--
-- Stripe keeps the two modes entirely apart: a customer or a saved card made
-- in test mode does not exist in live mode. Each parent's Stripe customer and
-- saved payment method therefore records the mode it was made in, and nothing
-- is ever charged across modes.
-- ============================================================================

SET search_path = ops, public, extensions;

INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('payments', 'stripe_mode', 'test', 'Stripe Mode',
     'test = Stripe sandbox, no real money. live = real cards and bank accounts. Switch from the Stripe card in Settings.',
     'text', 10),
    ('payments', 'stripe_test_secret_key', '', 'Test Secret Key', 'From the Stripe sandbox. Starts with sk_test_', 'secret', 11),
    ('payments', 'stripe_test_webhook_secret', '', 'Test Webhook Secret', 'From the sandbox webhook. Starts with whsec_', 'secret', 12),
    ('payments', 'stripe_live_secret_key', '', 'Live Secret Key', 'From Stripe in live mode. Starts with sk_live_', 'secret', 13),
    ('payments', 'stripe_live_webhook_secret', '', 'Live Webhook Secret', 'From the live-mode webhook. Starts with whsec_', 'secret', 14)
ON CONFLICT (key) DO NOTHING;

-- The keys in use until now are the sandbox's; carry them over, and retire
-- the old single-key settings.
UPDATE config t SET value = o.value
  FROM config o
 WHERE t.key = 'stripe_test_secret_key' AND o.key = 'stripe_secret_key' AND t.value = '';
UPDATE config t SET value = o.value
  FROM config o
 WHERE t.key = 'stripe_test_webhook_secret' AND o.key = 'stripe_webhook_secret' AND t.value = '';
DELETE FROM config WHERE key IN ('stripe_secret_key', 'stripe_webhook_secret');

-- Which mode a parent's Stripe customer and saved payment method belong to.
ALTER TABLE parents
    ADD COLUMN stripe_customer_mode text CHECK (stripe_customer_mode IN ('test', 'live')),
    ADD COLUMN autopay_mode text CHECK (autopay_mode IN ('test', 'live'));

-- Everything made so far was made in the sandbox.
UPDATE parents SET stripe_customer_mode = 'test' WHERE stripe_customer_id IS NOT NULL;
UPDATE parents SET autopay_mode = 'test' WHERE autopay_payment_method_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- When the Gmail script last checked in. It posts every 15 minutes, with or
-- without emails, so a script that has stopped shows up on the Payments page
-- instead of being discovered when families are chased for money they paid.
-- 'internal' settings are kept by the app and not shown for editing.
-- ----------------------------------------------------------------------------
INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('internal', 'zelle_script_last_seen', '', 'Zelle script last checked in', NULL, 'text', 0)
ON CONFLICT (key) DO NOTHING;
