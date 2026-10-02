-- ============================================================================
-- Email that sends itself, for families with an address on file.
--
-- WhatsApp stays the main channel, sent by hand from the Outbox. Email covers
-- what nobody should have to tap through: a receipt for every payment, a note
-- when an automatic payment fails, the payment-page invite, and the overdue
-- reminder. It goes out through Resend from risingstars.training.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE emails (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- What this email is about, e.g. "receipt:pi_123". Stripe redelivers
    -- webhooks and the cron runs daily; the same event must never email a
    -- parent twice, so the event, not the attempt, is the key.
    dedupe_key   text        NOT NULL UNIQUE,
    kind         text        NOT NULL
                             CHECK (kind IN ('receipt', 'payment_failed', 'invite', 'reminder')),
    parent_id    uuid        REFERENCES parents (id) ON DELETE SET NULL,
    to_address   text        NOT NULL,
    subject      text        NOT NULL,
    body_text    text        NOT NULL,
    -- 'skipped' is written when sending is not set up, so what would have gone
    -- out is still on record.
    status       text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    provider_id  text,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz
);

CREATE INDEX emails_parent_idx ON emails (parent_id, created_at DESC);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage emails"
    ON emails FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON emails TO authenticated, service_role;

INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('messaging', 'emails_enabled', 'true', 'Email Parents',
     'Email receipts, failed-payment notices, payment links and reminders to families who have an email on file.',
     'toggle', 8),
    ('messaging', 'email_from', 'Rising Stars <payments@risingstars.training>', 'Send Email As',
     'The sender parents see. Must be an address at a domain verified in Resend.',
     'text', 9),
    ('messaging', 'email_reply_to', '', 'Replies Go To',
     'Your own inbox. When a parent replies to a receipt, it lands here.',
     'text', 10)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Overdue reminders, once.
--
-- The daily cron selected every invoice overdue by N days *or more*, so an
-- unpaid invoice was reminded every day, forever. It never mattered while no
-- message was ever sent; with the Outbox and email it would. An invoice is now
-- reminded once, and this is when.
-- ----------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN reminded_at timestamptz;
