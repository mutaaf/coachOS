-- ============================================================================
-- A WhatsApp group per program, and the emails that welcome a family.
--
-- Parents used to be told "we'll message you on WhatsApp" whether or not
-- there was anywhere to message them. Now a program can carry its group's
-- invite link; a family is pointed at WhatsApp only when it has one, and the
-- link arrives in their welcome email and on the confirmation screen — never
-- on a public page, so the group stays among families who signed up.
--
-- The new emails are logged like the rest, keyed so each is sent at most
-- once: registration:<registration id>, welcome:<enrollment id>.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE programs
    ADD COLUMN whatsapp_group_url text
        CHECK (whatsapp_group_url IS NULL OR whatsapp_group_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]+/?(\?.*)?$');

COMMENT ON COLUMN programs.whatsapp_group_url IS
  'Invite link to this program''s WhatsApp group (https://chat.whatsapp.com/…). Shared only with registered families.';

ALTER TABLE emails DROP CONSTRAINT emails_kind_check;
ALTER TABLE emails ADD CONSTRAINT emails_kind_check
    CHECK (kind IN ('receipt', 'payment_failed', 'invite', 'reminder', 'registration', 'welcome'));
