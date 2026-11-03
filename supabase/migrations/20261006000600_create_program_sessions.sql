-- ============================================================================
-- One save for "a program, at these schools, this season, on the website".
--
-- Putting a program on at two schools and on the website used to be a string
-- of separate saves (program, each session, each weekly time, each listing).
-- A failure half-way left a program on at one school, or on at both but not
-- on the website. ops.create_program_sessions does it all in one transaction:
-- every row or none.
--
-- Input (jsonb) — built by apps/web/src/lib/new-program.ts toPayload():
--   program   {id} or {name, sport, age_groups[], description,
--             default_monthly_fee, default_capacity}
--   season    {id} or {name, start_date, end_date} or null
--   start_date, end_date   the sessions' dates (default: the season's)
--   slots     [{dow 0-6, start "HH:MM", end "HH:MM"}] — every school's
--             weekly practices unless a school has its own
--   location  where at the school ("Gym") — optional
--   registration_open  bool
--   sessions  [{school: {id} | {name, address}, monthly_fee, capacity,
--               coach_id, slots, location}] — one per school; empty values
--             take the program's defaults and the shared slots
--   website   {show, title, description, media_id, featured}
--
-- Returns {catalog_id, season_id, sessions: [{id, school_id, school_name,
-- public_slug, listing_id}]}.
--
-- Called by CoachOS's server (service role) after its admin check; nobody
-- else may execute it.
-- ============================================================================

SET search_path = ops, public, extensions;

-- The registration link's slug, as apps/web/src/lib/actions/programs.ts makes
-- it: lower-case words joined by hyphens, a number added when it's taken.
CREATE OR REPLACE FUNCTION ops.unique_program_slug(p_text text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_base text := left(
    btrim(regexp_replace(normalize(lower(coalesce(p_text, '')), NFKD), '[^a-z0-9]+', '-', 'g'), '-'),
    60);
  v_candidate text;
BEGIN
  IF v_base = '' THEN v_base := 'program'; END IF;
  FOR i IN 1..50 LOOP
    v_candidate := CASE WHEN i = 1 THEN v_base ELSE v_base || '-' || i END;
    IF NOT EXISTS (SELECT 1 FROM ops.programs WHERE public_slug = v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RETURN v_base || '-' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION ops.create_program_sessions(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_prog       jsonb := coalesce(p -> 'program', '{}'::jsonb);
  v_seas       jsonb := p -> 'season';
  v_web        jsonb := coalesce(p -> 'website', '{}'::jsonb);
  v_catalog    ops.program_catalog;
  v_season     ops.seasons;
  v_start      date;
  v_end        date;
  v_status     text;
  v_s          jsonb;
  v_school     ops.schools;
  v_school_ids uuid[] := '{}';
  v_slots      jsonb;
  v_slot       jsonb;
  v_fee        numeric;
  v_capacity   integer;
  v_coach      uuid;
  v_location   text;
  v_program_id uuid;
  v_slug       text;
  v_listing_id uuid;
  v_media_id   uuid;
  v_name       text;
  v_out        jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p -> 'sessions') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'sessions') = 0 THEN
    RAISE EXCEPTION 'Pick at least one school.' USING ERRCODE = 'P0001';
  END IF;

  -- The program: chosen, or new.
  IF nullif(v_prog ->> 'id', '') IS NOT NULL THEN
    SELECT * INTO v_catalog FROM ops.program_catalog WHERE id = (v_prog ->> 'id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'That program is no longer there. Reload and pick it again.'; END IF;
  ELSE
    v_name := btrim(coalesce(v_prog ->> 'name', ''));
    IF v_name = '' THEN RAISE EXCEPTION 'Give the program a name.'; END IF;
    IF EXISTS (SELECT 1 FROM ops.program_catalog WHERE lower(btrim(name)) = lower(v_name)) THEN
      RAISE EXCEPTION 'There''s already a program called "%". Pick it from the list instead.', v_name;
    END IF;
    INSERT INTO ops.program_catalog (name, sport, description, age_groups, default_monthly_fee, default_capacity)
    VALUES (
      v_name,
      coalesce(nullif(lower(btrim(v_prog ->> 'sport')), ''), 'basketball'),
      coalesce(btrim(v_prog ->> 'description'), ''),
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(v_prog -> 'age_groups', '[]'::jsonb))), '{}'),
      coalesce(nullif(v_prog ->> 'default_monthly_fee', '')::numeric, 0),
      coalesce(nullif(v_prog ->> 'default_capacity', '')::integer, 12)
    )
    RETURNING * INTO v_catalog;
  END IF;
  IF v_catalog.status = 'archived' THEN
    RAISE EXCEPTION '% is archived. Bring it back on the Programs page first.', v_catalog.name;
  END IF;

  -- The season: chosen, new (an existing name is that season), or none.
  IF v_seas IS NOT NULL AND jsonb_typeof(v_seas) = 'object' THEN
    IF nullif(v_seas ->> 'id', '') IS NOT NULL THEN
      SELECT * INTO v_season FROM ops.seasons WHERE id = (v_seas ->> 'id')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'That season is no longer there. Reload and pick it again.'; END IF;
    ELSIF btrim(coalesce(v_seas ->> 'name', '')) <> '' THEN
      SELECT * INTO v_season FROM ops.seasons WHERE lower(btrim(name)) = lower(btrim(v_seas ->> 'name'));
      IF NOT FOUND THEN
        v_start := nullif(v_seas ->> 'start_date', '')::date;
        v_end := nullif(v_seas ->> 'end_date', '')::date;
        IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
          RAISE EXCEPTION 'The season ends before it starts.';
        END IF;
        INSERT INTO ops.seasons (name, start_date, end_date, status)
        VALUES (btrim(v_seas ->> 'name'), v_start, v_end,
                CASE WHEN v_end IS NOT NULL AND v_end < v_today THEN 'closed'
                     WHEN v_start IS NOT NULL AND v_start > v_today THEN 'upcoming'
                     ELSE 'active' END)
        RETURNING * INTO v_season;
      END IF;
    END IF;
  END IF;
  IF v_season.status = 'closed' THEN
    RAISE EXCEPTION '% is closed. Pick a current or upcoming season.', v_season.name;
  END IF;

  v_start := coalesce(nullif(p ->> 'start_date', '')::date, v_season.start_date);
  v_end := coalesce(nullif(p ->> 'end_date', '')::date, v_season.end_date);
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
    RAISE EXCEPTION 'The end date is before the start date.';
  END IF;
  v_status := CASE
    WHEN v_season.id IS NOT NULL THEN CASE WHEN v_season.status = 'upcoming' THEN 'upcoming' ELSE 'active' END
    WHEN v_start IS NOT NULL AND v_start > v_today THEN 'upcoming'
    ELSE 'active' END;

  IF nullif(v_web ->> 'media_id', '') IS NOT NULL THEN
    v_media_id := (v_web ->> 'media_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM ops.site_media WHERE id = v_media_id AND status = 'ready') THEN
      RAISE EXCEPTION 'That photo is no longer in the library. Pick another.';
    END IF;
  END IF;

  FOR v_s IN SELECT * FROM jsonb_array_elements(p -> 'sessions') LOOP
    -- The school: chosen, or new (an existing name is that school).
    IF nullif(v_s #>> '{school,id}', '') IS NOT NULL THEN
      SELECT * INTO v_school FROM ops.schools WHERE id = (v_s #>> '{school,id}')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'A school you picked is no longer there. Reload and try again.'; END IF;
    ELSE
      v_name := btrim(regexp_replace(coalesce(v_s #>> '{school,name}', ''), '\s+', ' ', 'g'));
      IF v_name = '' THEN RAISE EXCEPTION 'Give the new school a name.'; END IF;
      SELECT * INTO v_school FROM ops.schools
       WHERE lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = lower(v_name)
       ORDER BY (status = 'archived'), created_at
       LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO ops.schools (name, address, status)
        VALUES (v_name, nullif(btrim(v_s #>> '{school,address}'), ''), 'active')
        RETURNING * INTO v_school;
      ELSIF v_school.address IS NULL AND nullif(btrim(v_s #>> '{school,address}'), '') IS NOT NULL THEN
        UPDATE ops.schools SET address = btrim(v_s #>> '{school,address}') WHERE id = v_school.id
        RETURNING * INTO v_school;
      END IF;
    END IF;
    IF v_school.status = 'archived' THEN
      RAISE EXCEPTION '% is archived. Bring it back on the Schools page first.', v_school.name;
    END IF;
    IF v_school.id = ANY (v_school_ids) THEN
      RAISE EXCEPTION '% is in the list twice.', v_school.name;
    END IF;
    v_school_ids := v_school_ids || v_school.id;

    v_fee := coalesce(nullif(v_s ->> 'monthly_fee', '')::numeric, v_catalog.default_monthly_fee);
    IF v_fee < 0 THEN RAISE EXCEPTION 'The fee at % can''t be below 0.', v_school.name; END IF;
    v_capacity := coalesce(nullif(v_s ->> 'capacity', '')::integer, v_catalog.default_capacity);
    IF v_capacity <= 0 THEN RAISE EXCEPTION 'How many children can join at %? Enter a number above 0.', v_school.name; END IF;
    v_coach := nullif(v_s ->> 'coach_id', '')::uuid;
    IF v_coach IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ops.coaches WHERE id = v_coach) THEN
      RAISE EXCEPTION 'The coach picked for % is no longer there.', v_school.name;
    END IF;
    v_location := nullif(btrim(coalesce(v_s ->> 'location', p ->> 'location', '')), '');

    v_slug := ops.unique_program_slug(v_school.name || ' ' || v_catalog.name);
    INSERT INTO ops.programs (
      school_id, name, season, catalog_id, season_id, start_date, end_date, monthly_fee, status,
      capacity, registration_open, location, public_description, public_slug)
    VALUES (
      v_school.id, v_catalog.name, v_season.name, v_catalog.id, v_season.id, v_start, v_end,
      round(v_fee, 2), v_status, v_capacity, coalesce((p ->> 'registration_open')::boolean, false),
      v_location, nullif(btrim(v_catalog.description), ''), v_slug)
    RETURNING id INTO v_program_id;

    v_slots := CASE WHEN jsonb_typeof(v_s -> 'slots') = 'array' THEN v_s -> 'slots'
                    ELSE coalesce(p -> 'slots', '[]'::jsonb) END;
    FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
      IF (v_slot ->> 'dow')::int NOT BETWEEN 0 AND 6 THEN
        RAISE EXCEPTION 'Pick a day for each weekly practice.';
      END IF;
      IF (v_slot ->> 'end')::time <= (v_slot ->> 'start')::time THEN
        RAISE EXCEPTION 'A practice at % ends before it starts.', v_school.name;
      END IF;
      INSERT INTO ops.schedule_templates (program_id, day_of_week, start_time, end_time, location, coach_id)
      VALUES (v_program_id, (v_slot ->> 'dow')::int, (v_slot ->> 'start')::time, (v_slot ->> 'end')::time,
              v_location, v_coach);
    END LOOP;

    v_listing_id := NULL;
    IF coalesce((v_web ->> 'show')::boolean, false) THEN
      -- The marketing overlay. Price, places, dates and place are filled from
      -- the session by public.listing_follows_session().
      INSERT INTO public.programs (
        title, description, date_range, location, image, slots, price, age_groups, type,
        ops_program_id, published, featured)
      VALUES (
        coalesce(nullif(btrim(v_web ->> 'title'), ''), v_catalog.name),
        coalesce(nullif(btrim(v_web ->> 'description'), ''), v_catalog.description, ''),
        '', '', '', '', '', v_catalog.age_groups,
        CASE WHEN v_status = 'upcoming' THEN 'upcoming' ELSE 'current' END,
        v_program_id, true, coalesce((v_web ->> 'featured')::boolean, false))
      RETURNING id INTO v_listing_id;
      IF v_media_id IS NOT NULL THEN
        INSERT INTO ops.site_media_placements (media_id, slot, offering_id) VALUES (v_media_id, 'offering', v_program_id);
      END IF;
    END IF;

    v_out := v_out || jsonb_build_object(
      'id', v_program_id, 'school_id', v_school.id, 'school_name', v_school.name,
      'public_slug', v_slug, 'listing_id', v_listing_id);
  END LOOP;

  RETURN jsonb_build_object('catalog_id', v_catalog.id, 'season_id', v_season.id, 'sessions', v_out);
END;
$$;

REVOKE ALL ON FUNCTION ops.create_program_sessions(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ops.unique_program_slug(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.create_program_sessions(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION ops.unique_program_slug(text) TO service_role;
