-- ============================================================================
-- Messages sent by hand from the owner's own phone.
--
-- The WhatsApp bot (whatsapp-web.js driving a headless browser) was never
-- deployed, and is not going to be: it is unofficial, breaks when WhatsApp
-- updates, and WhatsApp bans numbers that send automated messages — the
-- owner's number is how 35 groups of parents reach her.
--
-- Instead, queued messages wait in an outbox. Each one opens WhatsApp (or
-- Messages) on her phone with the text already written to that parent; she
-- presses send. The queue, templates and everything that fills them are
-- unchanged — only the last step moved into her hand.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE message_queue DROP CONSTRAINT IF EXISTS message_queue_status_check;
ALTER TABLE message_queue ADD CONSTRAINT message_queue_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- How it left: from her phone by WhatsApp or text, or by a bot if one is ever
-- connected. Null while it is still waiting.
ALTER TABLE message_queue ADD COLUMN sent_via text
    CHECK (sent_via IN ('whatsapp', 'sms', 'bot'));
