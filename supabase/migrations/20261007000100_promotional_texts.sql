-- ============================================================================
-- Promotional texts need their own consent, and keep Texas quiet hours.
-- (Website contract v1.3, 2026-10-05.)
--
-- Rising Stars is not registered with the Texas Secretary of State as a
-- telephone solicitor (Tex. Bus. & Com. Code ch. 302, as amended by SB 140).
-- Without that registration a promotional text — news, offers, a new
-- program — may go only to a parent who gave prior express written consent to
-- marketing texts. Agreeing to texts about their child's program (`sms`) is
-- not that consent. So:
--
--   * a new consent kind, `sms_promotional`, recorded like the others
--     (ops.record_consent, ops.consent_log, columns on ops.parents), taken
--     from a website registration's p_consents and an inquiry's
--     p_details.consents;
--   * a message with purpose = 'promotional' goes only to a parent whose
--     latest promotional answer is yes (ops.sms_promotional_choice). Plain
--     `sms` consent is not enough. Nothing is backfilled: a parent who only
--     ever agreed to program texts is not eligible for promotions;
--   * a STOP (or "no texts") withdraws promotional consent too, and clears
--     any promotion waiting in the Outbox;
--   * a promotion can't be marked sent outside Texas quiet hours
--     (§301.051): Mon–Sat 9 a.m.–9 p.m., Sun noon–9 p.m., America/Chicago.
--     Compose refuses to queue one outside those hours too (lib/quiet-hours.ts);
--     the database guards the moment it is sent.
--
-- Operational texts (practice, payment, schedule changes) keep today's rule:
-- every parent who hasn't said STOP.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Where the answer lives.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.parents
  ADD COLUMN IF NOT EXISTS sms_promotional_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_promotional_opt_out_at timestamptz;

COMMENT ON COLUMN ops.parents.sms_promotional_consent_at IS
  'When the parent gave prior express written consent to promotional texts (offers, new programs). Separate from sms_consent_at, which covers program texts only. Null: none on file — no promotions.';
COMMENT ON COLUMN ops.parents.sms_promotional_opt_out_at IS
  'When the parent withdrew consent to promotional texts (or said STOP to all texts). Wins over an earlier consent.';

ALTER TABLE ops.consent_log DROP CONSTRAINT IF EXISTS consent_log_kind_check;
ALTER TABLE ops.consent_log ADD CONSTRAINT consent_log_kind_check
  CHECK (kind IN ('terms', 'medical', 'photo', 'sms', 'sms_promotional', 'marketing_email'));

-- ----------------------------------------------------------------------------
-- 2. Recording a decision. Identical to 20261006000100 apart from the new
--    kind, and a STOP (`sms` = false) now also withdraws promotional consent.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.record_consent(
  p_kind            text,
  p_granted         boolean,
  p_source          text,
  p_parent_id       uuid DEFAULT NULL,
  p_student_id      uuid DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL,
  p_at              timestamptz DEFAULT now(),
  p_policy_version  text DEFAULT NULL,
  p_documents       jsonb DEFAULT NULL,
  p_recorded_by     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at        timestamptz := coalesce(p_at, now());
  v_had_promo boolean := false;
BEGIN
  IF p_kind NOT IN ('terms', 'medical', 'photo', 'sms', 'sms_promotional', 'marketing_email') THEN
    RAISE EXCEPTION 'Unknown consent: %', p_kind USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'sms' AND p_parent_id IS NOT NULL THEN
    IF p_granted THEN
      UPDATE ops.parents
         SET sms_consent_at = v_at,
             sms_opt_out_at = CASE WHEN sms_opt_out_at < v_at THEN NULL ELSE sms_opt_out_at END
       WHERE id = p_parent_id
         AND (sms_consent_at IS NULL OR sms_consent_at < v_at)
         AND (sms_opt_out_at IS NULL OR sms_opt_out_at < v_at);
    ELSE
      UPDATE ops.parents SET sms_opt_out_at = v_at
       WHERE id = p_parent_id AND (sms_opt_out_at IS NULL OR sms_opt_out_at < v_at);
      -- STOP means every text, promotions included.
      SELECT sms_promotional_consent_at IS NOT NULL
             AND sms_promotional_consent_at <= v_at
             AND (sms_promotional_opt_out_at IS NULL OR sms_promotional_opt_out_at < sms_promotional_consent_at)
        INTO v_had_promo
        FROM ops.parents WHERE id = p_parent_id;
      UPDATE ops.parents SET sms_promotional_opt_out_at = v_at
       WHERE id = p_parent_id AND (sms_promotional_opt_out_at IS NULL OR sms_promotional_opt_out_at < v_at);
      IF coalesce(v_had_promo, false) THEN
        INSERT INTO ops.consent_log (parent_id, student_id, registration_id, kind, granted, source,
                                     policy_version, documents, recorded_at, recorded_by)
        VALUES (p_parent_id, NULL, p_registration_id, 'sms_promotional', false, left(p_source, 50),
                left(p_policy_version, 50), p_documents, v_at, p_recorded_by);
      END IF;
    END IF;
  ELSIF p_kind = 'sms_promotional' AND p_parent_id IS NOT NULL THEN
    IF p_granted THEN
      UPDATE ops.parents
         SET sms_promotional_consent_at = v_at,
             sms_promotional_opt_out_at = CASE WHEN sms_promotional_opt_out_at < v_at THEN NULL ELSE sms_promotional_opt_out_at END
       WHERE id = p_parent_id
         AND (sms_promotional_consent_at IS NULL OR sms_promotional_consent_at < v_at)
         AND (sms_promotional_opt_out_at IS NULL OR sms_promotional_opt_out_at < v_at);
    ELSE
      UPDATE ops.parents SET sms_promotional_opt_out_at = v_at
       WHERE id = p_parent_id AND (sms_promotional_opt_out_at IS NULL OR sms_promotional_opt_out_at < v_at);
    END IF;
  ELSIF p_kind = 'marketing_email' AND p_parent_id IS NOT NULL THEN
    IF p_granted THEN
      UPDATE ops.parents
         SET marketing_email_consent_at = v_at,
             marketing_email_opt_out_at = CASE WHEN marketing_email_opt_out_at < v_at THEN NULL ELSE marketing_email_opt_out_at END
       WHERE id = p_parent_id
         AND (marketing_email_consent_at IS NULL OR marketing_email_consent_at < v_at)
         AND (marketing_email_opt_out_at IS NULL OR marketing_email_opt_out_at < v_at);
    ELSE
      UPDATE ops.parents SET marketing_email_opt_out_at = v_at
       WHERE id = p_parent_id AND (marketing_email_opt_out_at IS NULL OR marketing_email_opt_out_at < v_at);
    END IF;
  ELSIF p_kind = 'photo' AND p_student_id IS NOT NULL THEN
    UPDATE ops.students SET photo_release = p_granted, photo_release_at = v_at
     WHERE id = p_student_id AND (photo_release_at IS NULL OR photo_release_at <= v_at);
  END IF;

  INSERT INTO ops.consent_log (parent_id, student_id, registration_id, kind, granted, source,
                               policy_version, documents, recorded_at, recorded_by)
  VALUES (p_parent_id, p_student_id, p_registration_id, p_kind, p_granted, left(p_source, 50),
          left(p_policy_version, 50), p_documents, v_at, p_recorded_by);
END;
$$;

REVOKE ALL ON FUNCTION ops.record_consent(text, boolean, text, uuid, uuid, uuid, timestamptz, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.record_consent(text, boolean, text, uuid, uuid, uuid, timestamptz, text, jsonb, uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 3. The latest promotional answer for a number (or parent), from everywhere
--    one is recorded — like ops.sms_choice. A "no" to texts at all (STOP, or
--    an unticked texts box on the website) is a no to promotions as well.
--    true: yes; false: no; null: never asked — and null means no promotions.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.sms_promotional_choice(p_phone text, p_parent_id uuid DEFAULT NULL)
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
  regs AS (
    SELECT r.consents FROM ops.registrations r, k
     WHERE r.parent_id IN (SELECT id FROM people) OR (k.key IS NOT NULL AND ops.phone_key(r.parent_phone) = k.key)
  ),
  inqs AS (
    SELECT i.consents FROM ops.inquiries i, k
     WHERE k.key IS NOT NULL AND ops.phone_key(i.phone) = k.key
  ),
  answers AS (
    SELECT true AS granted, sms_promotional_consent_at AS at FROM people WHERE sms_promotional_consent_at IS NOT NULL
    UNION ALL
    SELECT false, sms_promotional_opt_out_at FROM people WHERE sms_promotional_opt_out_at IS NOT NULL
    UNION ALL
    SELECT false, sms_opt_out_at FROM people WHERE sms_opt_out_at IS NOT NULL
    UNION ALL
    SELECT (c ->> 'sms_promotional')::boolean, (c ->> 'accepted_at')::timestamptz
      FROM (SELECT consents AS c FROM regs UNION ALL SELECT consents FROM inqs) x
     WHERE jsonb_typeof(c -> 'sms_promotional') = 'boolean'
    UNION ALL
    SELECT false, (c ->> 'accepted_at')::timestamptz
      FROM (SELECT consents AS c FROM regs UNION ALL SELECT consents FROM inqs) x
     WHERE c -> 'sms' = 'false'::jsonb
  )
  SELECT granted FROM answers ORDER BY at DESC NULLS LAST, granted ASC LIMIT 1
$$;

REVOKE ALL ON FUNCTION ops.sms_promotional_choice(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.sms_promotional_choice(text, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Texas quiet hours (§301.051): no solicitation before 9 a.m. or after
--    9 p.m. Mon–Sat, or before noon or after 9 p.m. Sunday. Both ends
--    inclusive (9:00:00 p.m. is not "after 9"). Mirrors lib/quiet-hours.ts.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.promotional_text_allowed(p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN extract(isodow FROM l) = 7
              THEN l::time >= time '12:00' AND l::time <= time '21:00'
              ELSE l::time >= time '09:00' AND l::time <= time '21:00' END
    FROM (SELECT p_at AT TIME ZONE 'America/Chicago' AS l) t
$$;

REVOKE ALL ON FUNCTION ops.promotional_text_allowed(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.promotional_text_allowed(timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. The way into the Outbox. Identical to 20261006000130 apart from the
--    promotional rule.
-- ----------------------------------------------------------------------------

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
  ELSIF NEW.purpose = 'promotional'
        AND ops.sms_promotional_choice(NEW.recipient_phone, NEW.parent_id) IS NOT TRUE THEN
    NEW.status := 'skipped';
    NEW.error := 'Not sent: this parent hasn''t agreed to promotional texts. Agreeing to program texts doesn''t cover promotions.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.message_respects_consent() FROM PUBLIC, anon, authenticated;

-- A promotion can't be marked sent outside quiet hours. It stays waiting.
CREATE OR REPLACE FUNCTION ops.promotion_keeps_quiet_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.purpose = 'promotional' AND NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent'
     AND NOT ops.promotional_text_allowed(now()) THEN
    RAISE EXCEPTION 'Texas law doesn''t allow promotional texts right now. They can go Monday–Saturday 9 a.m.–9 p.m. and Sunday noon–9 p.m. (Texas time). It''s still waiting in the Outbox.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.promotion_keeps_quiet_hours() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_promotion_quiet_hours ON ops.message_queue;
CREATE TRIGGER message_promotion_quiet_hours
  BEFORE UPDATE OF status ON ops.message_queue
  FOR EACH ROW EXECUTE FUNCTION ops.promotion_keeps_quiet_hours();

-- Promotional consent withdrawn now: any promotion waiting for them is cleared.
CREATE OR REPLACE FUNCTION ops.skip_queued_promotions_after_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.sms_promotional_opt_out_at IS NOT NULL
     AND NEW.sms_promotional_opt_out_at IS DISTINCT FROM OLD.sms_promotional_opt_out_at THEN
    UPDATE ops.message_queue
       SET status = 'skipped', error = 'Not sent: this parent withdrew consent to promotional texts.'
     WHERE status = 'pending' AND purpose = 'promotional'
       AND (parent_id = NEW.id OR ops.phone_key(recipient_phone) = ops.phone_key(NEW.phone));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.skip_queued_promotions_after_opt_out() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS parents_skip_queued_promotions ON ops.parents;
CREATE TRIGGER parents_skip_queued_promotions
  AFTER UPDATE OF sms_promotional_opt_out_at ON ops.parents
  FOR EACH ROW EXECUTE FUNCTION ops.skip_queued_promotions_after_opt_out();

COMMENT ON COLUMN ops.message_queue.purpose IS
  'operational: about the child''s program (practice, payment, schedule) — to every parent who hasn''t said STOP. promotional: news, offers, new programs — only to parents whose latest sms_promotional answer is yes, and only sent within Texas quiet hours.';

-- ----------------------------------------------------------------------------
-- 6. A registration placed on the roster carries its promotional answer too.
--    Identical to 20261006000100 apart from `sms_promotional`.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.apply_registration_consents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c   jsonb := NEW.consents;
  at  timestamptz;
  ver text;
  doc jsonb;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    at := (c ->> 'accepted_at')::timestamptz;
  EXCEPTION WHEN others THEN
    at := NULL;
  END;
  at  := coalesce(at, NEW.created_at, now());
  ver := c ->> 'policy_version';
  doc := CASE WHEN jsonb_typeof(c -> 'documents') = 'object' THEN c -> 'documents' END;

  IF NEW.parent_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    IF jsonb_typeof(c -> 'sms') = 'boolean' THEN
      PERFORM ops.record_consent('sms', (c ->> 'sms')::boolean, 'website_registration',
                                 NEW.parent_id, NULL, NEW.id, at, ver, doc);
    END IF;
    -- A yes to promotions alongside a no to texts at all is a no.
    IF jsonb_typeof(c -> 'sms_promotional') = 'boolean'
       AND NOT (c -> 'sms_promotional' = 'true'::jsonb AND c -> 'sms' = 'false'::jsonb) THEN
      PERFORM ops.record_consent('sms_promotional', (c ->> 'sms_promotional')::boolean, 'website_registration',
                                 NEW.parent_id, NULL, NEW.id, at, ver, doc);
    END IF;
    IF jsonb_typeof(c -> 'marketing_email') = 'boolean' THEN
      PERFORM ops.record_consent('marketing_email', (c ->> 'marketing_email')::boolean, 'website_registration',
                                 NEW.parent_id, NULL, NEW.id, at, ver, doc);
    END IF;
  END IF;

  IF NEW.student_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.student_id IS DISTINCT FROM OLD.student_id) THEN
    IF jsonb_typeof(c -> 'photo') = 'boolean' THEN
      PERFORM ops.record_consent('photo', (c ->> 'photo')::boolean, 'website_registration',
                                 NEW.parent_id, NEW.student_id, NEW.id, at, ver, doc);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.apply_registration_consents() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN ops.registrations.consents IS
  'What the parent agreed to on the website, exactly as sent (contract v1.3: terms, medical, photo, sms, sms_promotional, marketing_email, policy_version, documents{…}, and any future keys), plus accepted_at: when the server received it.';

-- ----------------------------------------------------------------------------
-- 7. The inquiry door takes sms_promotional. Identical to 20261006000120
--    apart from: a promotional opt-in needs a number too, and a yes is
--    recorded on the matching parent like the program-texts yes.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_inquiry(
  p_kind        text,
  p_contact     jsonb,
  p_details     jsonb DEFAULT NULL,
  p_attribution jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact   jsonb := CASE WHEN jsonb_typeof(p_contact) = 'object' THEN p_contact ELSE '{}'::jsonb END;
  v_details   jsonb := CASE WHEN jsonb_typeof(p_details) = 'object' THEN p_details ELSE '{}'::jsonb END;
  v_first     text  := left(nullif(btrim(v_contact ->> 'first_name'), ''), 100);
  v_last      text  := left(nullif(btrim(v_contact ->> 'last_name'), ''), 100);
  v_raw_phone text  := left(nullif(btrim(v_contact ->> 'phone'), ''), 40);
  v_phone     text;
  v_email     text  := lower(left(nullif(btrim(v_contact ->> 'email'), ''), 254));
  v_message   text  := left(nullif(btrim(v_details ->> 'message'), ''), 5000);
  v_org       text  := left(nullif(btrim(v_details ->> 'organization'), ''), 200);
  v_offering  uuid;
  v_types     text[];
  v_recent    integer;
  v_id        uuid;
  v_req_type  text;
  v_children  text[];
  v_parent    uuid;
  v_consents  jsonb;
  v_match     record;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('general', 'trial', 'waitlist_interest', 'program_question', 'birthday_party',
                                      'partnership', 'privacy_request') THEN
    RAISE EXCEPTION 'Unknown inquiry kind: %', coalesce(p_kind, 'none') USING ERRCODE = '22023';
  END IF;

  v_phone := coalesce(ops.normalize_phone(v_raw_phone), v_raw_phone);
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please check the email address.' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'Please give us a phone number or an email so we can reply.' USING ERRCODE = '22023';
  END IF;

  IF octet_length(v_details::text) > 16384 THEN
    RAISE EXCEPTION 'That message is too long.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_details -> 'consents') = 'object' THEN
    v_consents := (v_details -> 'consents') - 'accepted_at'
      || CASE WHEN (v_details -> 'consents') ? 'accepted_at'
              THEN jsonb_build_object('client_accepted_at', v_details #> '{consents,accepted_at}')
              ELSE '{}'::jsonb END
      || jsonb_build_object('accepted_at', now());
    -- A text opt-in needs a number to text.
    IF v_phone IS NULL THEN
      v_consents := v_consents - 'sms' - 'sms_promotional';
    END IF;
  END IF;

  IF p_kind = 'privacy_request' THEN
    v_req_type := lower(btrim(v_details ->> 'request_type'));
    IF v_req_type IS NULL OR v_req_type NOT IN ('access', 'delete', 'correct', 'opt_out', 'appeal') THEN
      RAISE EXCEPTION 'Please choose what you would like us to do with your information.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- One person sending more than five in an hour is a script, not a family;
  -- and more than thirty a minute across everyone is a flood.
  SELECT count(*) INTO v_recent
    FROM ops.inquiries i
   WHERE i.created_at > now() - interval '1 hour'
     AND ((v_phone IS NOT NULL AND ops.phone_key(i.phone) = ops.phone_key(v_phone))
       OR (v_email IS NOT NULL AND lower(i.email) = v_email));
  SELECT v_recent + count(*) INTO v_recent
    FROM ops.leads l
   WHERE l.source = 'website'
     AND l.created_at > now() - interval '1 hour'
     AND ((v_phone IS NOT NULL AND ops.phone_key(l.contact_phone) = ops.phone_key(v_phone))
       OR (v_email IS NOT NULL AND lower(l.contact_email) = v_email));
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'Too many messages from you in the last hour. Please call or text us instead.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_recent FROM ops.inquiries WHERE created_at > now() - interval '1 minute';
  SELECT v_recent + count(*) INTO v_recent FROM ops.leads WHERE source = 'website' AND created_at > now() - interval '1 minute';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'We''re getting a lot of messages right now. Please try again in a minute.' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'partnership' THEN
    INSERT INTO ops.leads (school_name, contact_name, contact_email, contact_phone, notes, stage, source, attribution)
    VALUES (
      coalesce(v_org, nullif(btrim(concat_ws(' ', v_first, v_last)), ''), v_email, v_phone),
      nullif(btrim(concat_ws(' ', v_first, v_last)), ''),
      v_email,
      v_phone,
      v_message,
      'identified',
      'website',
      ops.clean_attribution(p_attribution)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_kind = 'privacy_request' THEN
    IF jsonb_typeof(v_details -> 'child_first_names') = 'array' THEN
      SELECT coalesce(array_agg(left(btrim(x), 100)) FILTER (WHERE btrim(x) <> ''), '{}')
        INTO v_children
        FROM (SELECT jsonb_array_elements_text(v_details -> 'child_first_names') AS x LIMIT 10) s;
    END IF;

    -- The family it is probably about: exactly one parent with this phone or
    -- email. Staff still verify the requester before acting on it.
    SELECT CASE WHEN count(*) = 1 THEN min(p.id::text)::uuid END INTO v_parent
      FROM ops.parents p
     WHERE (v_phone IS NOT NULL AND ops.phone_key(p.phone) = ops.phone_key(v_phone))
        OR (v_email IS NOT NULL AND lower(p.email) = v_email);

    INSERT INTO ops.inquiries (
      kind, first_name, last_name, phone, email, message, attribution,
      request_type, child_first_names, privacy_status, due_at, parent_id, details, consents
    ) VALUES (
      p_kind, v_first, v_last, v_phone, v_email, v_message, ops.clean_attribution(p_attribution),
      v_req_type, coalesce(v_children, '{}'), 'received',
      -- 45 days to answer (§541.052(b)); an appeal is decided within 60 (§541.053(b)).
      now() + CASE WHEN v_req_type = 'appeal' THEN interval '60 days' ELSE interval '45 days' END,
      v_parent, v_details, v_consents
    )
    RETURNING id INTO v_id;

    PERFORM ops.audit('website', 'privacy.received', 'inquiry', v_id,
                      jsonb_build_object('request_type', v_req_type, 'matched_family', v_parent IS NOT NULL));
    RETURN v_id;
  END IF;

  -- Only a session that exists; a stale id from a cached page is dropped, not an error.
  IF (v_details ->> 'offering_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o.id INTO v_offering FROM ops.programs o WHERE o.id = (v_details ->> 'offering_id')::uuid;
  END IF;

  IF jsonb_typeof(v_details -> 'inquiry_types') = 'array' THEN
    SELECT coalesce(array_agg(left(btrim(x), 50)) FILTER (WHERE btrim(x) <> ''), '{}')
      INTO v_types
      FROM (SELECT jsonb_array_elements_text(v_details -> 'inquiry_types') AS x LIMIT 10) s;
  END IF;

  INSERT INTO ops.inquiries (
    kind, first_name, last_name, phone, email, message, child_ages, offering_id,
    sport, inquiry_types, preferred_date, organization, attribution, details, consents
  ) VALUES (
    p_kind, v_first, v_last, v_phone, v_email, v_message,
    left(nullif(btrim(v_details ->> 'child_ages'), ''), 200),
    v_offering,
    left(nullif(btrim(v_details ->> 'sport'), ''), 50),
    coalesce(v_types, '{}'),
    left(nullif(btrim(v_details ->> 'preferred_date'), ''), 50),
    v_org,
    ops.clean_attribution(p_attribution),
    v_details,
    v_consents
  )
  RETURNING id INTO v_id;

  -- An opt-in here counts for the family on file with this number or address.
  IF v_consents IS NOT NULL THEN
    IF v_consents -> 'sms' = 'true'::jsonb THEN
      FOR v_match IN SELECT p.id FROM ops.parents p WHERE ops.phone_key(p.phone) = ops.phone_key(v_phone) LOOP
        PERFORM ops.record_consent('sms', true, 'website_inquiry', v_match.id, NULL, NULL, now(),
                                   v_consents ->> 'policy_version',
                                   CASE WHEN jsonb_typeof(v_consents -> 'documents') = 'object' THEN v_consents -> 'documents' END);
      END LOOP;
    END IF;
    -- v1.3: prior express written consent to promotional texts.
    IF v_consents -> 'sms_promotional' = 'true'::jsonb THEN
      FOR v_match IN SELECT p.id FROM ops.parents p WHERE ops.phone_key(p.phone) = ops.phone_key(v_phone) LOOP
        PERFORM ops.record_consent('sms_promotional', true, 'website_inquiry', v_match.id, NULL, NULL, now(),
                                   v_consents ->> 'policy_version',
                                   CASE WHEN jsonb_typeof(v_consents -> 'documents') = 'object' THEN v_consents -> 'documents' END);
      END LOOP;
    END IF;
    IF v_consents -> 'marketing_email' = 'true'::jsonb AND v_email IS NOT NULL THEN
      FOR v_match IN SELECT p.id FROM ops.parents p WHERE lower(p.email) = v_email LOOP
        PERFORM ops.record_consent('marketing_email', true, 'website_inquiry', v_match.id, NULL, NULL, now(),
                                   v_consents ->> 'policy_version',
                                   CASE WHEN jsonb_typeof(v_consents -> 'documents') = 'object' THEN v_consents -> 'documents' END);
      END LOOP;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) TO anon, authenticated, service_role;
