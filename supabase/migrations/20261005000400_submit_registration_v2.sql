-- ============================================================================
-- public.submit_registration_v2 — a family signs up all their children at once.
--
-- v1 takes one child per call, so siblings were separate submissions: the
-- second could fail after the first went through, a double-click made two of
-- each, and the website then had to find "the registration it just made" by
-- phone number and first name to send the welcome email and WhatsApp link —
-- which let anyone who knew a phone number and a child's name ask the same.
--
-- v2, for the website (docs/WEBSITE_CONTRACT.md):
--
--   * Every child in one transaction: all of them are registered, or none.
--     Seats go in the order the children are listed; once the session is full
--     the rest are waitlisted, exactly as v1 does it (ops.submit_registration
--     locks the session row, so the cap holds under concurrent sign-ups).
--   * An idempotency key from the browser: sending the same key again returns
--     the first result and writes nothing. Two in flight at once with the same
--     key wait for each other.
--   * Consents are stored on each registration (terms must be accepted), with
--     the policy version the parent saw.
--   * Attribution is stored, cleaned to the agreed keys.
--   * It returns each child's outcome and a notify_token: an HMAC over the
--     sorted registration ids and an expiry an hour out, which
--     /api/registrations/notify checks (ops.verify_notify_token) before it
--     sends anything or reveals a WhatsApp link.
--
-- The HMAC secret is generated here, at random, when the migration runs, and
-- lives in ops.app_secrets, which no API role can read: only the functions
-- below (running as their owner) use it. CoachOS never needs a copy — the
-- notify route asks the database to verify. To rotate it (outstanding tokens,
-- at most an hour old, stop working):
--
--   UPDATE ops.app_secrets
--      SET value = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
--    WHERE name = 'registration_notify_hmac';
--
-- v1 (public.submit_registration) is untouched and keeps working.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Secrets only the database's own functions can read.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.app_secrets (
  name       text        PRIMARY KEY,
  value      text        NOT NULL CHECK (length(value) >= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ops.app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies, and no privileges for any API role: not anon, not a signed-in
-- admin, not even the service role. ops' default privileges would otherwise
-- grant the last two.
REVOKE ALL ON ops.app_secrets FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE ops.app_secrets IS
  'Secrets used only inside SECURITY DEFINER functions. No API role can read this table.';

INSERT INTO ops.app_secrets (name, value)
VALUES ('registration_notify_hmac', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. What v2 stores on each registration, and the idempotency record.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.registrations ADD COLUMN IF NOT EXISTS consents jsonb;
ALTER TABLE ops.registrations ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE INDEX IF NOT EXISTS registrations_idempotency ON ops.registrations (idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN ops.registrations.consents IS
  'What the parent agreed to on the website: {terms, medical, photo, policy_version, accepted_at}.';

CREATE TABLE IF NOT EXISTS ops.registration_submissions (
  idempotency_key uuid        PRIMARY KEY,
  offering_id     uuid        NOT NULL,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ops.registration_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.registration_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ops.registration_submissions TO service_role;

-- ----------------------------------------------------------------------------
-- 3. The notify token.
--
--   v1.<expires, unix seconds>.<hex HMAC-SHA256(secret, "<sorted ids, comma-joined>|<expires>")>
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.notify_token_signature(p_ids uuid[], p_expires bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(
           extensions.hmac(
             (SELECT string_agg(DISTINCT x::text, ',' ORDER BY x::text) FROM unnest(p_ids) x) || '|' || p_expires::text,
             (SELECT value FROM ops.app_secrets WHERE name = 'registration_notify_hmac'),
             'sha256'),
           'hex')
$$;

REVOKE ALL ON FUNCTION ops.notify_token_signature(uuid[], bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION ops.issue_notify_token(p_ids uuid[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 'v1.' || e::text || '.' || ops.notify_token_signature(p_ids, e)
    FROM (SELECT (extract(epoch FROM now() + interval '1 hour'))::bigint AS e) t
$$;

REVOKE ALL ON FUNCTION ops.issue_notify_token(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- True when the token was issued by submit_registration_v2 for exactly these
-- registrations and is less than an hour old. Called by CoachOS's notify
-- route with the service role.
CREATE OR REPLACE FUNCTION ops.verify_notify_token(p_registration_ids uuid[], p_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m        text[];
  expires  bigint;
BEGIN
  IF p_registration_ids IS NULL OR cardinality(p_registration_ids) = 0 OR p_token IS NULL THEN
    RETURN false;
  END IF;
  m := regexp_match(p_token, '^v1\.([0-9]{1,12})\.([0-9a-f]{64})$');
  IF m IS NULL THEN
    RETURN false;
  END IF;
  expires := m[1]::bigint;
  IF expires < extract(epoch FROM now())::bigint THEN
    RETURN false;
  END IF;
  RETURN ops.notify_token_signature(p_registration_ids, expires) = m[2];
END;
$$;

REVOKE ALL ON FUNCTION ops.verify_notify_token(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.verify_notify_token(uuid[], text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. The door.
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
  v_consents := jsonb_build_object(
    'terms',          true,
    'medical',        coalesce(p_consents -> 'medical' = 'true'::jsonb, false),
    'photo',          coalesce(p_consents -> 'photo' = 'true'::jsonb, false),
    'policy_version', left(p_consents ->> 'policy_version', 50),
    'accepted_at',    now()
  );

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

    -- Raises 'Registration is closed for …' exactly as v1 does; the whole
    -- family's sign-up is then rolled back.
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
