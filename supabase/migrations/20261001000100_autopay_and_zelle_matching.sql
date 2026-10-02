-- ============================================================================
-- Getting paid without asking every month.
--
-- Until now every payment started with the owner posting a reminder in each
-- session's WhatsApp group, then reading the replies ("sent via zelle", "can I
-- get an invoice?") and recording each one by hand. Two things replace that:
--
--   * Autopay. A parent saves a bank account or card once, from a personal
--     link, and each invoice is charged on its due date.
--   * Zelle matching. Families who would rather keep using Zelle still can.
--     The bank's "you received money" emails are forwarded here, matched to the
--     family by sender name and amount, and recorded as payments.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- Parents: a personal payment page and a saved payment method
-- ----------------------------------------------------------------------------

ALTER TABLE parents
    -- Goes in the URL of the parent's payment page. The page shows their
    -- children's first names and what is owed, so it is long and random; it is
    -- volatile, so every existing parent gets their own value.
    ADD COLUMN pay_token text NOT NULL UNIQUE
        DEFAULT translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),

    -- 'pending' is a bank account waiting on micro-deposit verification.
    ADD COLUMN autopay_status text NOT NULL DEFAULT 'off'
        CHECK (autopay_status IN ('off', 'pending', 'active')),
    ADD COLUMN autopay_method text
        CHECK (autopay_method IN ('us_bank_account', 'card')),
    ADD COLUMN autopay_payment_method_id text,
    -- "Chase ••••6789", shown back to the parent so they know what is on file.
    ADD COLUMN autopay_label text,
    -- Stripe's page for confirming micro-deposits, while status is 'pending'.
    ADD COLUMN autopay_verify_url text,
    -- When the current payment method was saved. A charge that failed is only
    -- retried once this moves past the failed attempt — retrying the same
    -- declined card every day would just collect decline fees.
    ADD COLUMN autopay_enabled_at timestamptz;

-- ----------------------------------------------------------------------------
-- Invoices: a charge in flight
-- ----------------------------------------------------------------------------

-- 'processing' is a bank debit that has been started and not yet settled, which
-- takes several days. It has to be a status of its own: every overdue sweep
-- moves 'pending' to 'overdue', and a family who paid on the 1st would
-- otherwise be chased for money already on its way.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('pending', 'processing', 'paid', 'overdue', 'waived'));

ALTER TABLE invoices
    ADD COLUMN autopay_payment_intent_id text,
    ADD COLUMN autopay_status text
        CHECK (autopay_status IN ('processing', 'succeeded', 'failed')),
    ADD COLUMN autopay_error text,
    ADD COLUMN autopay_attempted_at timestamptz;

-- ----------------------------------------------------------------------------
-- Zelle: the bank's notification emails, and who each sender is
-- ----------------------------------------------------------------------------

CREATE TABLE zelle_receipts (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The email's own id. The forwarding script re-sends recent emails on every
    -- run, so this is what stops one payment being recorded several times.
    message_id   text          NOT NULL UNIQUE,
    -- Null when the email could not be read; it is kept so the owner can see it.
    sender_name  text,
    amount       numeric(10,2),
    memo         text,
    received_at  timestamptz   NOT NULL DEFAULT now(),
    status       text          NOT NULL DEFAULT 'unmatched'
                               CHECK (status IN ('matched', 'unmatched', 'unreadable', 'ignored')),
    -- Who it was matched to, or the best guess when it needs a look.
    parent_id    uuid          REFERENCES parents (id) ON DELETE SET NULL,
    -- Why it was not matched automatically, in words the owner can act on.
    note         text,
    subject      text,
    body         text,
    created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX zelle_receipts_status_idx ON zelle_receipts (status, received_at DESC);

-- Zelle shows the name on the sender's bank account, which is often not the
-- name on file — a spouse, a maiden name, a grandparent paying. Once the owner
-- says who a sender is, every later payment from them matches on its own.
CREATE TABLE zelle_senders (
    sender_key  text        PRIMARY KEY,  -- normalised: lowercase, letters only
    parent_id   uuid        NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Payments: where the money came from
-- ----------------------------------------------------------------------------

ALTER TABLE payments
    -- Stripe's id for the charge. Stripe redelivers webhooks, and without this
    -- each redelivery recorded the payment again.
    ADD COLUMN external_id text UNIQUE,
    ADD COLUMN zelle_receipt_id uuid REFERENCES zelle_receipts (id) ON DELETE SET NULL,
    -- A card fee collected on top of the invoice. Kept apart from `amount` so the
    -- invoice still balances to exactly what was owed.
    ADD COLUMN fee numeric(10,2) NOT NULL DEFAULT 0;

CREATE INDEX payments_zelle_receipt_idx ON payments (zelle_receipt_id)
    WHERE zelle_receipt_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Access: the same as every other operational table. `anon` has no USAGE on
-- `ops`; the parent's page and the email endpoint reach these through the
-- service role.
-- ----------------------------------------------------------------------------

ALTER TABLE zelle_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE zelle_senders  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage zelle receipts"
    ON zelle_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage zelle senders"
    ON zelle_senders FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON zelle_receipts, zelle_senders TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Settings
-- ----------------------------------------------------------------------------

INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('payments', 'card_fee_percent', '3', 'Card Fee (%)',
     'Added to autopay charges made by card, and shown to the parent before they choose. Bank accounts have no fee.',
     'number', 13),
    ('payments', 'zelle_recipient', '', 'Zelle Number or Email',
     'Where parents send Zelle payments. Shown on each family''s payment page.',
     'text', 14),
    ('payments', 'zelle_inbound_secret', encode(extensions.gen_random_bytes(24), 'hex'), 'Zelle Email Key',
     'Lets the Gmail script report Zelle payments. Change it to cut off a script you no longer trust.',
     'text', 15)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

INSERT INTO message_templates (name, category, body, variables) VALUES
    (
        'autopay_invite',
        'payment',
        E'Hi {{parent_name}}! You can now pay for {{student_names}} automatically each month — from your bank account (no fee) or by card. It takes a minute: {{pay_link}}\n\nPrefer Zelle? The link has the details, and you won''t need to message us when you''ve sent it.',
        ARRAY['parent_name', 'student_names', 'pay_link']
    ),
    (
        'autopay_failed',
        'payment',
        E'Hi {{parent_name}}, the automatic payment of {{amount}} for {{student_name}}''s {{program_name}} didn''t go through ({{reason}}). You can update your payment details or pay another way here: {{pay_link}}',
        ARRAY['parent_name', 'amount', 'student_name', 'program_name', 'reason', 'pay_link']
    );

-- The reminder now carries the family's link. Only replaced where it is still
-- the shipped wording, so a reminder the owner has rewritten is left alone.
UPDATE message_templates
   SET body = E'Hi {{parent_name}}, this is a friendly reminder that the {{month}} payment of {{amount}} for {{student_name}}''s {{program_name}} is due. You can pay here: {{pay_link}}. Thank you!',
       variables = ARRAY['parent_name', 'month', 'amount', 'student_name', 'program_name', 'payment_method', 'pay_link']
 WHERE name = 'payment_reminder'
   AND body = E'Hi {{parent_name}}, this is a friendly reminder that the {{month}} payment of {{amount}} for {{student_name}}''s {{program_name}} is due. Please send via {{payment_method}}. Thank you!';
