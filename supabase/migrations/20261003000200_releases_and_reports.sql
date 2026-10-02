-- ============================================================================
-- Releases, and problems the owner reports.
--
-- Every merge to main that changes something is a release with a strict
-- semantic version (vMAJOR.MINOR.PATCH, tagged in git). The release workflow
-- writes each one here through /api/releases, and the app shows the owner
-- what's new since she last looked — with "Show me" into the tour for each
-- new thing.
--
-- "Report a problem" saves here first. The report becomes a GitHub issue for
-- the agents (with family names and numbers taken out: the repository is
-- public), and is marked fixed when a release says it fixes that issue.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE releases (
  version     text PRIMARY KEY CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  title       text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  -- [{ "text": "...", "tourStep": "record-payment" }] — plain words for the owner
  notes       jsonb NOT NULL DEFAULT '[]',
  -- The commits, for whoever maintains it
  technical   text[] NOT NULL DEFAULT '{}',
  sha         text,
  released_at timestamptz NOT NULL DEFAULT now()
);

-- Newest first by version, not by date: two releases a minute apart must
-- still sort right.
CREATE INDEX releases_order ON releases (
  (split_part(version, '.', 1)::int) DESC,
  (split_part(version, '.', 2)::int) DESC,
  (split_part(version, '.', 3)::int) DESC
);

CREATE TABLE problem_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reported_by  text,
  page         text,
  version      text,
  message      text NOT NULL CHECK (length(btrim(message)) > 0),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'sent', 'fixed', 'closed')),
  issue_number integer,
  issue_url    text,
  fixed_in     text REFERENCES releases (version)
);

CREATE INDEX problem_reports_issue ON problem_reports (issue_number);

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_reports ENABLE ROW LEVEL SECURITY;

-- The app reads and writes these with the service role; nobody else.
GRANT ALL ON releases, problem_reports TO service_role;
REVOKE ALL ON releases, problem_reports FROM anon, authenticated;

-- When the daily cron last finished, so the nightly health check can tell a
-- cron that has stopped from a quiet day.
INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    ('internal', 'cron_last_run', '', 'Daily run last finished', NULL, 'text', 0)
ON CONFLICT (key) DO NOTHING;
