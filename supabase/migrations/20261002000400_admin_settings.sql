-- ============================================================================
-- Every address, number and key the business runs on is a setting, not code.
--
-- The owner's Gmail, the inbox her bank alerts go to, where Zelle is sent, who
-- receives replies, the business name parents see: all of it changes in
-- Settings and takes effect immediately, with no deploy. Personal addresses
-- are deliberately left blank here and filled in on the live database — they
-- don't belong in the repository.
-- ============================================================================

SET search_path = ops, public, extensions;

-- Field types that know what they hold: a secret is masked and copyable, an
-- email can be written to, a link opened, a phone messaged.
ALTER TABLE config DROP CONSTRAINT IF EXISTS config_field_type_check;
ALTER TABLE config ADD CONSTRAINT config_field_type_check
    CHECK (field_type IN ('toggle', 'number', 'text', 'time', 'select', 'textarea',
                          'secret', 'email', 'url', 'phone'));

UPDATE config SET field_type = 'secret'
 WHERE key IN ('stripe_secret_key', 'stripe_webhook_secret', 'zelle_inbound_secret');
UPDATE config SET field_type = 'email' WHERE key IN ('email_reply_to');
UPDATE config SET field_type = 'url'   WHERE key IN ('whatsapp_bot_url');
UPDATE config SET field_type = 'phone' WHERE key IN ('coach_phone');

INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('payments', 'zelle_alerts_inbox', '', 'Zelle Alerts Gmail',
     'The Gmail account the Zelle script runs in. Bank alerts must end up here to be recorded automatically.',
     'email', 16),
    ('payments', 'zelle_alerts_forward_from', '', 'Bank Alerts Arrive At',
     'If your bank emails Zelle alerts somewhere else (say, a Yahoo address), put it here — the app will remind you to forward from it. Leave blank if they already go to the Gmail above.',
     'email', 17)
ON CONFLICT (key) DO NOTHING;

-- Parents see this on every email and payment page.
UPDATE config
   SET description = 'Shown to parents on every email and payment page.'
 WHERE key = 'business_name';
UPDATE config SET value = 'Rising Stars Youth Academy'
 WHERE key = 'business_name' AND value = 'CoachOS';

-- ----------------------------------------------------------------------------
-- The WhatsApp bot is gone.
--
-- It was never deployed (no URL was ever configured, it never connected, and
-- it never sent a message), and it isn't coming back: it drove WhatsApp Web
-- unofficially, and WhatsApp bans numbers that automate. Messages are sent by
-- hand from the Outbox. Its state table, its URL setting and the "bot" way of
-- sending go with it.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS whatsapp_state;
DELETE FROM config WHERE key = 'whatsapp_bot_url';

ALTER TABLE message_queue DROP CONSTRAINT IF EXISTS message_queue_sent_via_check;
ALTER TABLE message_queue ADD CONSTRAINT message_queue_sent_via_check
    CHECK (sent_via IN ('whatsapp', 'sms'));
