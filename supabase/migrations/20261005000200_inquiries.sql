-- ============================================================================
-- Inquiries from the website land in CoachOS.
--
-- The website's contact, trial and "tell me when it opens" forms went to
-- Formspree: outside both systems, so a family's question lived in an inbox,
-- never next to the program they asked about or the registration that
-- followed. Now they arrive here, through one narrow door:
--
--   public.submit_inquiry(kind, contact, details, attribution) → id
--
--   * kind 'partnership' (a school or organisation) becomes a lead in the
--     existing schools pipeline, ops.leads, at stage 'identified';
--   * everything else becomes an ops.inquiries row the Boss works on the
--     Marketing page: new → contacted → trial_booked → registered → lost.
--
-- Like submit_registration it runs as its owner, can only write, and returns
-- only the new id. It is throttled per phone/email and globally, because it
-- is an unauthenticated write.
--
-- `attribution` holds where the family came from (UTM tags, click ids, GA
-- ids), as the website captured it. Only the agreed keys are kept, as short
-- text, so the column can't be used to store anything else.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Attribution, kept to the agreed shape.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.clean_attribution(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  touch_keys constant text[] := ARRAY['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                                      'gclid', 'fbclid', 'referrer', 'landing_path', 'ts'];
  result jsonb := '{}'::jsonb;
  touch  text;
  k      text;
  t      jsonb;
  clean  jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH touch IN ARRAY ARRAY['first_touch', 'last_touch'] LOOP
    t := p -> touch;
    CONTINUE WHEN t IS NULL OR jsonb_typeof(t) <> 'object';
    clean := '{}'::jsonb;
    FOREACH k IN ARRAY touch_keys LOOP
      IF jsonb_typeof(t -> k) IN ('string', 'number') THEN
        clean := clean || jsonb_build_object(k, left(t ->> k, 500));
      END IF;
    END LOOP;
    IF clean <> '{}'::jsonb THEN
      result := result || jsonb_build_object(touch, clean);
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['ga_client_id', 'ga_session_id'] LOOP
    IF jsonb_typeof(p -> k) IN ('string', 'number') THEN
      result := result || jsonb_build_object(k, left(p ->> k, 100));
    END IF;
  END LOOP;
  RETURN nullif(result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION ops.clean_attribution(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.clean_attribution(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Inquiries.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.inquiries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL
                              CHECK (kind IN ('general', 'trial', 'waitlist_interest', 'program_question', 'birthday_party')),
  status          text        NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'contacted', 'trial_booked', 'registered', 'lost')),
  first_name      text,
  last_name       text,
  phone           text,
  email           text,
  message         text,
  child_ages      text,
  -- The session they asked about, if any. Survives the session being deleted.
  offering_id     uuid        REFERENCES ops.programs (id) ON DELETE SET NULL,
  sport           text,
  inquiry_types   text[]      NOT NULL DEFAULT '{}',
  preferred_date  text,
  organization    text,
  -- Set when the family goes on to register.
  registration_id uuid        REFERENCES ops.registrations (id) ON DELETE SET NULL,
  attribution     jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS inquiries_created ON ops.inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_status ON ops.inquiries (status);
CREATE INDEX IF NOT EXISTS inquiries_phone ON ops.inquiries (ops.phone_key(phone));
CREATE INDEX IF NOT EXISTS inquiries_email ON ops.inquiries (lower(email));

CREATE TRIGGER inquiries_updated_at
  BEFORE UPDATE ON ops.inquiries
  FOR EACH ROW EXECUTE FUNCTION ops.update_updated_at_column();

ALTER TABLE ops.inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage inquiries" ON ops.inquiries FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
GRANT ALL ON ops.inquiries TO authenticated, service_role;
REVOKE ALL ON ops.inquiries FROM anon;

-- Schools and organisations that ask through the website are leads; where
-- they came from is kept the same way.
ALTER TABLE ops.leads ADD COLUMN IF NOT EXISTS attribution jsonb;
ALTER TABLE ops.leads ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN ops.leads.source IS 'Where the lead came from: null when added by hand, ''website'' from the site''s partnership form.';

-- ----------------------------------------------------------------------------
-- 3. The door.
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
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('general', 'trial', 'waitlist_interest', 'program_question', 'birthday_party', 'partnership') THEN
    RAISE EXCEPTION 'Unknown inquiry kind: %', coalesce(p_kind, 'none') USING ERRCODE = '22023';
  END IF;

  v_phone := coalesce(ops.normalize_phone(v_raw_phone), v_raw_phone);
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please check the email address.' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'Please give us a phone number or an email so we can reply.' USING ERRCODE = '22023';
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
    sport, inquiry_types, preferred_date, organization, attribution
  ) VALUES (
    p_kind, v_first, v_last, v_phone, v_email, v_message,
    left(nullif(btrim(v_details ->> 'child_ages'), ''), 200),
    v_offering,
    left(nullif(btrim(v_details ->> 'sport'), ''), 50),
    coalesce(v_types, '{}'),
    left(nullif(btrim(v_details ->> 'preferred_date'), ''), 50),
    v_org,
    ops.clean_attribution(p_attribution)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) TO anon, authenticated, service_role;
