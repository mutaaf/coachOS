-- ============================================================================
-- What each family agreed to, kept and acted on.
--
-- The website (contract v1.1) now sends more with a registration than terms,
-- medical and photo: `sms` (express written consent to program texts, under
-- the TCPA), `marketing_email` (newsletters), and the version of each document
-- the parent saw. Two things follow:
--
--   1. submit_registration_v2 stores the consents exactly as sent — unknown
--      keys included, so a new checkbox on the website never needs a CoachOS
--      release to be recorded — stamped with the time the server received it.
--      `terms` must still be true.
--
--   2. Consent has to follow the family onto the roster. A registration is
--      intake; the parent and child records are what CoachOS works from. When
--      a registration is placed (parent_id / student_id set), what it agreed
--      to is copied onto the parent (texts, marketing email) and the child
--      (photo release), and each change is written to ops.consent_log, the
--      history that proves when consent was given or withdrawn.
--
-- A later "no" wins over an earlier "yes", and an opt-out recorded after a
-- consent wins until the parent opts in again.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Where consent lives once a family is on the roster.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.parents
  ADD COLUMN IF NOT EXISTS sms_consent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at             timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_email_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_email_opt_out_at timestamptz;

COMMENT ON COLUMN ops.parents.sms_consent_at IS
  'When the parent gave express written consent to program texts (website checkbox or recorded by staff). Null: none on file.';
COMMENT ON COLUMN ops.parents.sms_opt_out_at IS
  'When the parent asked for texts to stop (STOP, or told staff). Wins over an earlier consent.';
COMMENT ON COLUMN ops.parents.marketing_email_consent_at IS
  'When the parent opted in to newsletters and promotions. Transactional email needs no opt-in.';
COMMENT ON COLUMN ops.parents.marketing_email_opt_out_at IS
  'When the parent unsubscribed from marketing email. Wins over an earlier opt-in.';

ALTER TABLE ops.students
  ADD COLUMN IF NOT EXISTS photo_release    boolean,
  ADD COLUMN IF NOT EXISTS photo_release_at timestamptz;

COMMENT ON COLUMN ops.students.photo_release IS
  'Parent''s photo/video release. true: may appear in photos the academy publishes. false or null: do not post.';

-- ----------------------------------------------------------------------------
-- 2. The history.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.consent_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       uuid        REFERENCES ops.parents (id) ON DELETE SET NULL,
  student_id      uuid        REFERENCES ops.students (id) ON DELETE SET NULL,
  registration_id uuid        REFERENCES ops.registrations (id) ON DELETE SET NULL,
  kind            text        NOT NULL CHECK (kind IN ('terms', 'medical', 'photo', 'sms', 'marketing_email')),
  granted         boolean     NOT NULL,
  -- website_registration, staff, sms_keyword, email_unsubscribe, privacy_request
  source          text        NOT NULL,
  policy_version  text,
  documents       jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  -- The staff member's auth id, when a person recorded it.
  recorded_by     uuid
);

CREATE INDEX IF NOT EXISTS consent_log_parent ON ops.consent_log (parent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS consent_log_student ON ops.consent_log (student_id, recorded_at DESC);

ALTER TABLE ops.consent_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read consent history" ON ops.consent_log FOR SELECT TO authenticated
  USING ((SELECT ops.is_admin()));
CREATE POLICY "Admins add consent history" ON ops.consent_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT ops.is_admin()));
-- History is appended to, never rewritten.
REVOKE ALL ON ops.consent_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON ops.consent_log FROM authenticated;
GRANT SELECT, INSERT ON ops.consent_log TO authenticated;
GRANT ALL ON ops.consent_log TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Recording a consent decision: the column and the history together.
--
-- p_at is when the decision was made. An older decision never overwrites a
-- newer one, so replaying an old registration can't undo a later STOP.
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
  v_at timestamptz := coalesce(p_at, now());
BEGIN
  IF p_kind NOT IN ('terms', 'medical', 'photo', 'sms', 'marketing_email') THEN
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
-- 4. A registration placed on the roster carries its consents with it.
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
  -- Only when the placement is new: a later edit to the same registration
  -- must not replay an old consent.
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

DROP TRIGGER IF EXISTS registrations_apply_consents ON ops.registrations;
CREATE TRIGGER registrations_apply_consents
  AFTER INSERT OR UPDATE OF parent_id, student_id ON ops.registrations
  FOR EACH ROW EXECUTE FUNCTION ops.apply_registration_consents();

-- ----------------------------------------------------------------------------
-- 5. submit_registration_v2 keeps the consents exactly as sent.
--
-- Identical to 20261005000400 except for the consents: the whole object is
-- stored (unknown keys included), plus `accepted_at`, the server's clock. A
-- browser's own `accepted_at`, if it sent one, is kept as
-- `client_accepted_at`. The object is capped at 16 KB so the column can't be
-- used to store anything else.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_registration_v2(
  p_offering_id     uuid,
  p_parent          jsonb,
  p_children        jsonb,
  p_consents        jsonb,
  p_attribution     jsonb DEFAULT NULL,
  p_idempotency_key uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent      jsonb := CASE WHEN jsonb_typeof(p_parent) = 'object' THEN p_parent ELSE '{}'::jsonb END;
  v_first       text  := left(nullif(btrim(v_parent ->> 'first_name'), ''), 100);
  v_last        text  := left(nullif(btrim(v_parent ->> 'last_name'), ''), 100);
  v_phone       text  := ops.normalize_phone(v_parent ->> 'phone');
  v_email       text  := lower(left(nullif(btrim(v_parent ->> 'email'), ''), 254));
  v_how_heard   text  := left(nullif(btrim(v_parent ->> 'how_heard'), ''), 200);
  v_consents    jsonb;
  v_attribution jsonb := ops.clean_attribution(p_attribution);
  v_count       integer;
  v_recent      integer;
  v_child       jsonb;
  v_dob_text    text;
  v_dob         date;
  v_reg         ops.registrations%ROWTYPE;
  v_ids         uuid[] := '{}';
  v_outcomes    jsonb  := '[]'::jsonb;
  v_result      jsonb;
  v_prior       ops.registration_submissions%ROWTYPE;
BEGIN
  -- Same key again: the first answer, nothing new written.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ops.registration_submissions (idempotency_key, offering_id)
    VALUES (p_idempotency_key, p_offering_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_prior FROM ops.registration_submissions WHERE idempotency_key = p_idempotency_key;
      IF v_prior.offering_id IS DISTINCT FROM p_offering_id THEN
        RAISE EXCEPTION 'This sign-up was already sent for a different program. Please refresh the page and try again.'
          USING ERRCODE = '22023';
      END IF;
      IF v_prior.result IS NOT NULL THEN
        RETURN v_prior.result;
      END IF;
    END IF;
  END IF;

  IF v_first IS NULL OR v_last IS NULL THEN
    RAISE EXCEPTION 'Please fill in the parent''s first and last name.' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Please check the phone number.' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please check the email address.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(jsonb_typeof(p_children), '') <> 'array' OR jsonb_array_length(p_children) = 0 THEN
    RAISE EXCEPTION 'Add at least one child.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_children);
  IF v_count > 8 THEN
    RAISE EXCEPTION 'Please register at most 8 children at once.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(jsonb_typeof(p_consents), '') <> 'object' OR p_consents -> 'terms' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Please accept the terms to register.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_consents::text) > 16384 THEN
    RAISE EXCEPTION 'The consent details are too long.' USING ERRCODE = '22023';
  END IF;
  -- Verbatim, plus the server's own timestamp.
  v_consents := p_consents - 'accepted_at'
    || CASE WHEN p_consents ? 'accepted_at'
            THEN jsonb_build_object('client_accepted_at', p_consents -> 'accepted_at')
            ELSE '{}'::jsonb END
    || jsonb_build_object('accepted_at', now());

  -- v1's throttle, counted per child: more than ten in an hour from one
  -- number is a script, not a family.
  SELECT count(*) INTO v_recent
    FROM ops.registrations r
   WHERE r.created_at > now() - interval '1 hour'
     AND ops.phone_key(r.parent_phone) = ops.phone_key(v_phone);
  IF v_recent + v_count > 10 THEN
    RAISE EXCEPTION 'Too many registrations from this number. Please message us instead.';
  END IF;

  -- And a flood from many numbers.
  SELECT count(*) INTO v_recent FROM ops.registrations WHERE created_at > now() - interval '1 minute';
  IF v_recent + v_count > 60 THEN
    RAISE EXCEPTION 'Too many registrations right now. Please try again in a minute.';
  END IF;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_children) LOOP
    IF jsonb_typeof(v_child) <> 'object'
       OR nullif(btrim(v_child ->> 'first_name'), '') IS NULL
       OR nullif(btrim(v_child ->> 'last_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Please fill in each child''s first and last name.' USING ERRCODE = '22023';
    END IF;
    v_dob_text := nullif(btrim(v_child ->> 'date_of_birth'), '');
    v_dob := NULL;
    IF v_dob_text IS NOT NULL THEN
      BEGIN
        v_dob := v_dob_text::date;
      EXCEPTION WHEN others THEN
        v_dob := NULL;
      END;
      IF v_dob IS NULL OR v_dob > current_date OR v_dob < current_date - interval '25 years' THEN
        RAISE EXCEPTION 'Please check %''s date of birth.', btrim(v_child ->> 'first_name') USING ERRCODE = '22023';
      END IF;
    END IF;

    v_reg := ops.submit_registration(
      p_offering_id,
      left(btrim(v_child ->> 'first_name'), 100),
      left(btrim(v_child ->> 'last_name'), 100),
      v_first,
      v_last,
      v_phone,
      v_email,
      left(nullif(btrim(v_child ->> 'grade'), ''), 30),
      v_dob,
      left(nullif(btrim(v_child ->> 'medical_notes'), ''), 2000),
      v_how_heard
    );

    UPDATE ops.registrations
       SET attribution = v_attribution, consents = v_consents, idempotency_key = p_idempotency_key
     WHERE id = v_reg.id;

    v_ids := v_ids || v_reg.id;
    v_outcomes := v_outcomes || jsonb_build_object(
      'registration_id',   v_reg.id,
      'child_first_name',  v_reg.child_first_name,
      'child_last_name',   v_reg.child_last_name,
      'status',            v_reg.status,
      'waitlist_position', v_reg.waitlist_position
    );
  END LOOP;

  v_result := jsonb_build_object('notify_token', ops.issue_notify_token(v_ids), 'outcomes', v_outcomes);

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE ops.registration_submissions SET result = v_result WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_registration_v2(uuid, jsonb, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_registration_v2(uuid, jsonb, jsonb, jsonb, jsonb, uuid) TO anon, authenticated, service_role;

COMMENT ON COLUMN ops.registrations.consents IS
  'What the parent agreed to on the website, exactly as sent (contract v1.1: terms, medical, photo, sms, marketing_email, policy_version, documents{…}, and any future keys), plus accepted_at: when the server received it.';
