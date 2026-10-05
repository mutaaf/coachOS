-- ============================================================================
-- Texts and email that respect what parents asked for.
--
-- Texts. CoachOS sends nothing by itself: every WhatsApp or SMS is opened on
-- the owner's phone from the Outbox and sent by hand (no autodialer, so the
-- TCPA's autodialer consent rule doesn't reach it — Facebook v. Duguid, 2021).
-- What still applies is the parent's word: someone who said STOP must not be
-- texted again (47 CFR 64.1200(a)(10)), and promotions go only to parents who
-- agreed to them. The database enforces both on the way into the Outbox, so
-- the daily reminders, Compose and every future path are covered alike:
--
--   * a parent who opted out — said STOP, or didn't tick "texts" on the
--     website's registration or contact form (the site then told them "we'll
--     call you") — gets nothing: anything queued for them is filed as
--     skipped, with the reason, instead of waiting to be sent;
--   * a message marked purpose = 'promotional' goes only to a parent with SMS
--     consent on file.
--
-- Email. Receipts, reminders and welcomes are transactional and go to every
-- family with an address. Marketing email (kind 'marketing') needs an opt-in,
-- honours an unsubscribe and the suppression list, and carries the
-- List-Unsubscribe headers and a postal address (lib/email.ts). The address
-- is a setting, blank until the owner fills it in.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Texts.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.message_queue
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'operational'
    CHECK (purpose IN ('operational', 'promotional'));

COMMENT ON COLUMN ops.message_queue.purpose IS
  'operational: about the child''s program (practice, payment, schedule) — sent to enrolled families. promotional: news, offers, new programs — only to parents with SMS consent.';

-- The latest explicit answer this number (or parent) gave about texts, from
-- every place one is recorded: the parent's record (consent given by staff,
-- a STOP), a website registration's consents, and a website inquiry's
-- consents. true: yes; false: no (or STOP); null: never asked.
--
-- Website answers are opt-ins: a parent who registered without ticking the
-- texts box was told "we'll call you", so a "no" there means no texts at all
-- — the same as a STOP — until they say yes somewhere later.
CREATE OR REPLACE FUNCTION ops.sms_choice(p_phone text, p_parent_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH k AS (SELECT ops.phone_key(p_phone) AS key),
  people AS (
    SELECT p.* FROM ops.parents p, k
     WHERE p.id = p_parent_id OR (k.key IS NOT NULL AND ops.phone_key(p.phone) = k.key)
  ),
  answers AS (
    SELECT true AS granted, sms_consent_at AS at FROM people WHERE sms_consent_at IS NOT NULL
    UNION ALL
    SELECT false, sms_opt_out_at FROM people WHERE sms_opt_out_at IS NOT NULL
    UNION ALL
    SELECT (r.consents ->> 'sms')::boolean, (r.consents ->> 'accepted_at')::timestamptz
      FROM ops.registrations r, k
     WHERE jsonb_typeof(r.consents -> 'sms') = 'boolean'
       AND (r.parent_id IN (SELECT id FROM people) OR (k.key IS NOT NULL AND ops.phone_key(r.parent_phone) = k.key))
    UNION ALL
    SELECT (i.consents ->> 'sms')::boolean, (i.consents ->> 'accepted_at')::timestamptz
      FROM ops.inquiries i, k
     WHERE jsonb_typeof(i.consents -> 'sms') = 'boolean'
       AND k.key IS NOT NULL AND ops.phone_key(i.phone) = k.key
  )
  SELECT granted FROM answers ORDER BY at DESC NULLS LAST, granted ASC LIMIT 1
$$;

REVOKE ALL ON FUNCTION ops.sms_choice(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.sms_choice(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION ops.message_respects_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_choice boolean;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  v_choice := ops.sms_choice(NEW.recipient_phone, NEW.parent_id);

  IF v_choice IS FALSE THEN
    -- Said STOP, or didn't agree to texts on the website.
    NEW.status := 'skipped';
    NEW.error := 'Not sent: this parent said STOP or didn''t agree to texts. Call or email instead.';
  ELSIF NEW.purpose = 'promotional' AND v_choice IS NOT TRUE THEN
    NEW.status := 'skipped';
    NEW.error := 'Not sent: a promotion needs the parent''s OK to texts, and there isn''t one on file.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.message_respects_consent() FROM PUBLIC, anon, authenticated;

-- Named to run after message_parent_from_phone (triggers fire in name order),
-- so parent_id is already filled in.
DROP TRIGGER IF EXISTS zz_message_respects_consent ON ops.message_queue;
CREATE TRIGGER zz_message_respects_consent
  BEFORE INSERT ON ops.message_queue
  FOR EACH ROW EXECUTE FUNCTION ops.message_respects_consent();

-- A STOP recorded now also clears what is already waiting for that parent.
CREATE OR REPLACE FUNCTION ops.skip_queued_after_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.sms_opt_out_at IS NOT NULL AND OLD.sms_opt_out_at IS NULL THEN
    UPDATE ops.message_queue
       SET status = 'skipped', error = 'Not sent: this parent asked not to get texts.'
     WHERE status = 'pending'
       AND (parent_id = NEW.id OR ops.phone_key(recipient_phone) = ops.phone_key(NEW.phone));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.skip_queued_after_opt_out() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS parents_skip_queued_after_opt_out ON ops.parents;
CREATE TRIGGER parents_skip_queued_after_opt_out
  AFTER UPDATE OF sms_opt_out_at ON ops.parents
  FOR EACH ROW EXECUTE FUNCTION ops.skip_queued_after_opt_out();

-- ----------------------------------------------------------------------------
-- 2. Email: suppression list and unsubscribe links.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.email_suppressions (
  email      text        PRIMARY KEY CHECK (email = lower(email)),
  -- marketing: no newsletters. all: nothing at all (hard bounce, spam complaint).
  scope      text        NOT NULL DEFAULT 'marketing' CHECK (scope IN ('marketing', 'all')),
  reason     text        NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual', 'erased')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ops.email_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage email suppressions" ON ops.email_suppressions FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
REVOKE ALL ON ops.email_suppressions FROM anon;
GRANT ALL ON ops.email_suppressions TO authenticated, service_role;

-- In every marketing email's unsubscribe link. Random, and says nothing about
-- the family by itself.
ALTER TABLE ops.parents
  ADD COLUMN IF NOT EXISTS unsubscribe_token text UNIQUE DEFAULT encode(extensions.gen_random_bytes(18), 'hex');
UPDATE ops.parents SET unsubscribe_token = encode(extensions.gen_random_bytes(18), 'hex') WHERE unsubscribe_token IS NULL;
ALTER TABLE ops.parents ALTER COLUMN unsubscribe_token SET NOT NULL;

-- One click, no sign-in, no questions (CAN-SPAM; RFC 8058). Returns whether
-- the token was known; answers the same way either way to the visitor.
CREATE OR REPLACE FUNCTION ops.unsubscribe_marketing(p_token text, p_source text DEFAULT 'email_unsubscribe')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent ops.parents%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{20,64}$' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_parent FROM ops.parents WHERE unsubscribe_token = p_token;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM ops.record_consent('marketing_email', false, p_source, v_parent.id);
  IF v_parent.email IS NOT NULL THEN
    INSERT INTO ops.email_suppressions (email, scope, reason)
    VALUES (lower(btrim(v_parent.email)), 'marketing', 'unsubscribed')
    ON CONFLICT (email) DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION ops.unsubscribe_marketing(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.unsubscribe_marketing(text, text) TO service_role;

ALTER TABLE ops.emails DROP CONSTRAINT IF EXISTS emails_kind_check;
ALTER TABLE ops.emails ADD CONSTRAINT emails_kind_check
  CHECK (kind IN ('receipt', 'payment_failed', 'invite', 'reminder', 'registration', 'welcome', 'marketing'));

-- The postal address CAN-SPAM requires in every marketing email (a PO box or
-- private mailbox is fine). Blank until filled in; marketing email refuses to
-- send without it.
INSERT INTO ops.config (category, key, value, label, description, field_type, sort_order) VALUES
  ('messaging', 'business_mailing_address', '', 'Mailing Address (for newsletters)',
   'The postal address printed at the bottom of every newsletter or promotion, as the law requires. A PO box is fine. Newsletters won''t send until this is filled in.',
   'textarea', 11)
ON CONFLICT (key) DO NOTHING;
