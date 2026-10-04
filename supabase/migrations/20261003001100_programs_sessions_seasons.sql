-- ============================================================================
-- Programs, sessions and seasons — the way the owner thinks about it.
--
--   Program  — created once: "Lil Dribblers (K–1) Basketball", its ages,
--              usual fee and places, description and picture.
--   Session  — a program at a school in a season: "Lil Dribblers at Lakehill,
--              Tuesdays, Fall 2026", with its own dates, places and roster.
--   Practice — one date of a session.
--   Season   — a term: "Fall 2026", its dates and no-class days.
--
-- In the database the names stay where they were, so nothing that reads them
-- breaks: a session is a row of ops.programs (as it always was), a practice
-- is a row of ops.sessions. New here: ops.program_catalog (the screen's
-- "Programs") and ops.seasons, which every session can point at.
--
-- programs.season (free text) is kept, in step with the season's name, for
-- one release: the website's views and older code still read it.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE seasons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  start_date     date,
  end_date       date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'closed')),
  -- Holidays and other days with no practice, for the whole season.
  no_class_dates date[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX seasons_name ON seasons (lower(btrim(name)));

CREATE TABLE program_catalog (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (length(btrim(name)) > 0),
  sport               text NOT NULL DEFAULT 'basketball',
  description         text NOT NULL DEFAULT '',
  age_groups          text[] NOT NULL DEFAULT '{}',
  default_monthly_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (default_monthly_fee >= 0),
  default_capacity    integer NOT NULL DEFAULT 12 CHECK (default_capacity > 0),
  image               text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_catalog_name ON program_catalog (lower(btrim(name)));

-- A session belongs to a program and a season. Neither can be deleted while
-- a session points at it: archive or close instead.
ALTER TABLE programs
  ADD COLUMN catalog_id uuid REFERENCES program_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN season_id  uuid REFERENCES seasons (id) ON DELETE RESTRICT;
CREATE INDEX programs_catalog ON programs (catalog_id);
CREATE INDEX programs_season ON programs (season_id);

-- Every existing session gets a program: one per distinct name, carrying the
-- fee, places and description of the most recent session with that name.
INSERT INTO program_catalog (name, description, default_monthly_fee, default_capacity)
SELECT DISTINCT ON (lower(btrim(name)))
       btrim(name), coalesce(public_description, ''), monthly_fee, capacity
  FROM programs
 ORDER BY lower(btrim(name)), created_at DESC;

UPDATE programs p SET catalog_id = c.id
  FROM program_catalog c
 WHERE lower(btrim(p.name)) = lower(btrim(c.name));

-- And a season, from the free text, spanning its sessions' dates.
INSERT INTO seasons (name, start_date, end_date, status)
SELECT btrim(season), min(start_date), max(end_date),
       CASE WHEN max(end_date) < current_date THEN 'closed'
            WHEN min(start_date) > current_date THEN 'upcoming'
            ELSE 'active' END
  FROM programs
 WHERE coalesce(btrim(season), '') <> ''
 GROUP BY lower(btrim(season)), btrim(season)
ON CONFLICT DO NOTHING;

UPDATE programs p SET season_id = s.id
  FROM seasons s
 WHERE lower(btrim(p.season)) = lower(btrim(s.name));

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage seasons" ON seasons FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
CREATE POLICY "Admins manage programs" ON program_catalog FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
GRANT ALL ON seasons, program_catalog TO authenticated, service_role;
REVOKE ALL ON seasons, program_catalog FROM anon;

-- Settings labels say what she now calls things (keys unchanged).
UPDATE config SET label = 'Default Practice Length (min)' WHERE key = 'default_session_duration_minutes';
UPDATE config SET label = 'Add Practices This Many Weeks Ahead' WHERE key = 'auto_generate_sessions_weeks';
