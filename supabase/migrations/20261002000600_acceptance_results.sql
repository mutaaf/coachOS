-- ============================================================================
-- The manual acceptance test plan, run inside CoachOS (Help → Test plan).
--
-- One row per test case: the result, the expected results the tester ticked,
-- and notes. Kept in the app so the person testing needs nothing but her
-- login, and so failures can be read back and fixed.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE acceptance_results (
    case_id     text        PRIMARY KEY,
    status      text        CHECK (status IN ('pass', 'fail', 'blocked', 'na')),
    ticks       integer[]   NOT NULL DEFAULT '{}',
    notes       text        NOT NULL DEFAULT '',
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acceptance_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage acceptance results"
    ON acceptance_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON acceptance_results TO authenticated, service_role;
