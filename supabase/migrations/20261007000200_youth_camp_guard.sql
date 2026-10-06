-- ============================================================================
-- A session that meets 4+ days in a row can't go on the website unlicensed.
--
-- Tex. Health & Safety Code ch. 141: a program caring for five or more
-- minors for four or more consecutive days is a "youth camp" and must be
-- licensed by the Department of State Health Services. Rising Stars holds no
-- such license and runs no camps (owner, 2026-10-05). Weekly practices never
-- come close — but a "camp week" (Mon–Fri) or a Mon–Thu schedule would, and
-- advertising one on the website would be offering an unlicensed camp.
--
-- So a session whose meetings (weekly times within its dates, plus any dated
-- practices) cover 4 or more consecutive days can only be on the website —
-- a published listing, or open for sign-ups with no listing, exactly as
-- public.site_offerings decides — when an admin has confirmed a current DSHS
-- youth camp license and entered its number, stored on the session.
--
-- Enforced on every way onto the website:
--   * a listing published (public.programs, insert or published → true);
--   * a weekly time added or moved on a session that's on the website;
--   * a session opened for sign-ups, re-dated or its license cleared.
-- The New program flow and the schedule template editor warn first
-- (lib/youth-camp.ts mirrors ops.longest_meeting_run).
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE ops.programs
  ADD COLUMN IF NOT EXISTS youth_camp_license_number      text
    CHECK (youth_camp_license_number IS NULL OR length(btrim(youth_camp_license_number)) BETWEEN 3 AND 60),
  ADD COLUMN IF NOT EXISTS youth_camp_license_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS youth_camp_license_confirmed_by uuid;

COMMENT ON COLUMN ops.programs.youth_camp_license_number IS
  'DSHS youth camp license number (Tex. Health & Safety Code ch. 141), entered by an admin who confirmed it is current. Required before a session meeting 4+ consecutive days can be on the website. Null: no license — Rising Stars holds none as of 2026-10-05.';
COMMENT ON COLUMN ops.programs.youth_camp_license_confirmed_at IS
  'When an admin confirmed "We hold a current DSHS youth camp license" for this session.';
COMMENT ON COLUMN ops.programs.youth_camp_license_confirmed_by IS
  'The auth user id of the admin who confirmed the license.';

-- ----------------------------------------------------------------------------
-- 1. The rule.
-- ----------------------------------------------------------------------------

-- The longest stretch of consecutive days with a meeting: weekly days within
-- [start, end] (capped at 400 days), or two weeks of the weekly pattern when
-- there are no dates (so a run past Saturday shows), plus individual dates.
CREATE OR REPLACE FUNCTION ops.longest_meeting_run(
  p_dows  integer[],
  p_start date,
  p_end   date,
  p_dates date[] DEFAULT '{}'
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH b AS (SELECT (p_start IS NOT NULL AND p_end IS NOT NULL AND p_end >= p_start) AS bounded),
  windows AS (
    SELECT p_start AS f, least(p_end, p_start + 400) AS t FROM b WHERE bounded
    UNION ALL
    SELECT date '2026-01-04', date '2026-01-17' FROM b WHERE NOT bounded
    UNION ALL
    SELECT x - 7, x + 7 FROM b, unnest(coalesce(p_dates, '{}'::date[])) x WHERE NOT bounded AND x IS NOT NULL
  ),
  days AS (
    SELECT g::date AS d
      FROM windows, generate_series(f::timestamp, t::timestamp, interval '1 day') g
     WHERE extract(dow FROM g)::integer = ANY (coalesce(p_dows, '{}'::integer[]))
    UNION
    SELECT x FROM unnest(coalesce(p_dates, '{}'::date[])) x WHERE x IS NOT NULL
  ),
  islands AS (SELECT d - (row_number() OVER (ORDER BY d))::integer AS grp FROM days)
  SELECT coalesce(max(n), 0)::integer FROM (SELECT count(*) AS n FROM islands GROUP BY grp) s
$$;

-- A session's longest run: its weekly times within its dates (or its
-- season's), plus every practice on the calendar that isn't cancelled.
CREATE OR REPLACE FUNCTION ops.program_meeting_run(p_program_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ops.longest_meeting_run(
           (SELECT coalesce(array_agg(DISTINCT t.day_of_week), '{}') FROM ops.schedule_templates t WHERE t.program_id = o.id),
           coalesce(o.start_date, se.start_date),
           coalesce(o.end_date, se.end_date),
           (SELECT coalesce(array_agg(DISTINCT s.date), '{}') FROM ops.sessions s
             WHERE s.program_id = o.id AND s.status <> 'cancelled'))
    FROM ops.programs o
    LEFT JOIN ops.seasons se ON se.id = o.season_id
   WHERE o.id = p_program_id
$$;

CREATE OR REPLACE FUNCTION ops.program_needs_camp_license(p_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(ops.program_meeting_run(o.id), 0) >= 4
         AND nullif(btrim(coalesce(o.youth_camp_license_number, '')), '') IS NULL
    FROM ops.programs o
   WHERE o.id = p_program_id
$$;

-- On the website exactly as public.site_offerings decides it.
CREATE OR REPLACE FUNCTION ops.program_on_website(p_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.status IN ('active', 'upcoming')
         AND coalesce((SELECT p.published FROM public.programs p
                        WHERE p.ops_program_id = o.id
                        ORDER BY p.updated_at DESC, p.id LIMIT 1),
                      o.registration_open)
    FROM ops.programs o
   WHERE o.id = p_program_id
$$;

REVOKE ALL ON FUNCTION ops.longest_meeting_run(integer[], date, date, date[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.program_meeting_run(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.program_needs_camp_license(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.program_on_website(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.longest_meeting_run(integer[], date, date, date[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.program_meeting_run(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.program_needs_camp_license(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.program_on_website(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION ops.youth_camp_blocked_message()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 'This session meets 4 or more days in a row — a youth camp under Texas law. It can''t be on the website or open for sign-ups until you confirm a current DSHS youth camp license and enter its number.'::text
$$;

-- ----------------------------------------------------------------------------
-- 2. The guards.
-- ----------------------------------------------------------------------------

-- A listing published (or pointed at a session) on the website.
CREATE OR REPLACE FUNCTION public.listing_needs_camp_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.ops_program_id IS NOT NULL AND coalesce(NEW.published, false)
     AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.published, false)
          OR NEW.ops_program_id IS DISTINCT FROM OLD.ops_program_id)
     AND ops.program_needs_camp_license(NEW.ops_program_id) THEN
    RAISE EXCEPTION '%', ops.youth_camp_blocked_message() USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.listing_needs_camp_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS listing_needs_camp_license ON public.programs;
CREATE TRIGGER listing_needs_camp_license
  BEFORE INSERT OR UPDATE OF published, ops_program_id ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.listing_needs_camp_license();

-- A weekly time added or moved on a session that's on the website.
CREATE OR REPLACE FUNCTION ops.template_needs_camp_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
      OR NEW.program_id IS DISTINCT FROM OLD.program_id)
     AND ops.program_on_website(NEW.program_id)
     AND ops.program_needs_camp_license(NEW.program_id) THEN
    RAISE EXCEPTION '%', ops.youth_camp_blocked_message() USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.template_needs_camp_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schedule_templates_camp_license ON ops.schedule_templates;
CREATE TRIGGER schedule_templates_camp_license
  AFTER INSERT OR UPDATE OF day_of_week, program_id ON ops.schedule_templates
  FOR EACH ROW EXECUTE FUNCTION ops.template_needs_camp_license();

-- A session opened for sign-ups, re-dated, brought back, or its license cleared.
CREATE OR REPLACE FUNCTION ops.session_needs_camp_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ((NEW.registration_open AND NOT OLD.registration_open)
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.end_date IS DISTINCT FROM OLD.end_date
      OR (NEW.status IN ('active', 'upcoming') AND OLD.status NOT IN ('active', 'upcoming'))
      OR (nullif(btrim(coalesce(NEW.youth_camp_license_number, '')), '') IS NULL
          AND nullif(btrim(coalesce(OLD.youth_camp_license_number, '')), '') IS NOT NULL))
     AND ops.program_on_website(NEW.id)
     AND ops.program_needs_camp_license(NEW.id) THEN
    RAISE EXCEPTION '%', ops.youth_camp_blocked_message() USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.session_needs_camp_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS programs_camp_license ON ops.programs;
CREATE TRIGGER programs_camp_license
  AFTER UPDATE OF registration_open, start_date, end_date, status, youth_camp_license_number ON ops.programs
  FOR EACH ROW EXECUTE FUNCTION ops.session_needs_camp_license();

-- ----------------------------------------------------------------------------
-- 3. The New program flow can carry a confirmed license.
--
-- Identical to 20261006000600 apart from `youth_camp_license`
-- ({number, confirmed_by}) in the input, stored on every session it makes.
-- The guards above do the refusing.
-- ----------------------------------------------------------------------------

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
  -- A DSHS youth camp license the admin confirmed, for a schedule that meets
  -- 4+ days in a row (20261007000200). Stored on every session made here.
  v_license    text := nullif(btrim(coalesce(p #>> '{youth_camp_license,number}', '')), '');
  v_lic_by     uuid := CASE WHEN (p #>> '{youth_camp_license,confirmed_by}') ~* '^[0-9a-f-]{36}$'
                            THEN (p #>> '{youth_camp_license,confirmed_by}')::uuid END;
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
      capacity, registration_open, location, public_description, public_slug,
      youth_camp_license_number, youth_camp_license_confirmed_at, youth_camp_license_confirmed_by)
    VALUES (
      v_school.id, v_catalog.name, v_season.name, v_catalog.id, v_season.id, v_start, v_end,
      round(v_fee, 2), v_status, v_capacity, coalesce((p ->> 'registration_open')::boolean, false),
      v_location, nullif(btrim(v_catalog.description), ''), v_slug,
      left(v_license, 60), CASE WHEN v_license IS NOT NULL THEN now() END,
      CASE WHEN v_license IS NOT NULL THEN v_lic_by END)
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
GRANT EXECUTE ON FUNCTION ops.create_program_sessions(jsonb) TO service_role;
