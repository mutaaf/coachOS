-- ============================================================================
-- A payment is recorded once, however many times the form is sent.
--
-- A double tap on "Record $40" saved two $40 payments 170ms apart. The dialog
-- now makes a key when it opens and sends it with the payment; the first
-- payment saved from that form carries it, and a second with the same key is
-- refused here, even when both arrive at once.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE payments ADD COLUMN client_key text;

CREATE UNIQUE INDEX payments_client_key_key ON payments (client_key) WHERE client_key IS NOT NULL;

COMMENT ON COLUMN payments.client_key IS
  'Made by the form that recorded the payment, so sending the same form twice records it once.';
