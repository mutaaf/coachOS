-- ============================================================================
-- Incident reports: injuries, illness, behaviour and safeguarding concerns.
--
-- A written record made at the time is what protects the child, the coach and
-- the business. Each report keeps what happened, what was done, when the
-- parent was told, and — for a safeguarding concern — when it was reported to
-- DFPS (Texas Family Code §261.101: anyone who suspects abuse must report it
-- immediately; it cannot be left to someone else).
--
-- Concussion. A child with a suspected concussion sits out until a licensed
-- health care professional clears them in writing (CDC HEADS UP; the standard
-- Texas schools follow, Educ. Code §38.157). Until the clearance is recorded
-- here, the database refuses to mark that child present or late at any
-- practice on or after the incident — from the dashboard and from a coach's
-- register alike.
--
-- Kept for as long as a claim could be brought: a child's two years only start
-- at 18 (Civ. Prac. & Rem. Code §16.001, §16.003), so incidents are never
-- touched by the retention job or a family's erasure request (the legal-claims
-- exemption, Bus. & Com. Code §541.201(a)(3)). Admins only.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE IF NOT EXISTS ops.incidents (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at            timestamptz NOT NULL,
  kind                   text        NOT NULL DEFAULT 'injury'
                                     CHECK (kind IN ('injury', 'illness', 'behavior', 'safeguarding', 'other')),
  program_id             uuid        REFERENCES ops.programs (id) ON DELETE SET NULL,
  session_id             uuid        REFERENCES ops.sessions (id) ON DELETE SET NULL,
  -- Never cascades: the report outlives the child's place on the roster.
  student_id             uuid        REFERENCES ops.students (id) ON DELETE RESTRICT,
  coach_id               uuid        REFERENCES ops.coaches (id) ON DELETE SET NULL,
  description            text        NOT NULL CHECK (btrim(description) <> ''),
  actions_taken          text,
  parent_notified_at     timestamptz,
  parent_notified_how    text,
  concussion_suspected   boolean     NOT NULL DEFAULT false,
  -- Written clearance from a licensed health care professional.
  cleared_to_return_at   timestamptz,
  clearance_provider     text,
  clearance_note         text,
  -- Safeguarding: the report to DFPS (1-800-252-5400, txabusehotline.org) or police.
  reported_to_authorities_at timestamptz,
  authority_reference    text,
  status                 text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (cleared_to_return_at IS NULL OR nullif(btrim(clearance_provider), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS incidents_student ON ops.incidents (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS incidents_occurred ON ops.incidents (occurred_at DESC);
CREATE INDEX IF NOT EXISTS incidents_holds ON ops.incidents (student_id)
  WHERE concussion_suspected AND cleared_to_return_at IS NULL;

CREATE TRIGGER incidents_updated_at
  BEFORE UPDATE ON ops.incidents
  FOR EACH ROW EXECUTE FUNCTION ops.update_updated_at_column();

ALTER TABLE ops.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage incidents" ON ops.incidents FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
REVOKE ALL ON ops.incidents FROM anon;
GRANT ALL ON ops.incidents TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Return-to-play: the incident keeping a child out on a given day, if any.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.return_to_play_hold(p_student_id uuid, p_on date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.id
    FROM ops.incidents i
   WHERE i.student_id = p_student_id
     AND i.concussion_suspected
     AND i.cleared_to_return_at IS NULL
     AND (i.occurred_at AT TIME ZONE 'America/Chicago')::date <= p_on
   ORDER BY i.occurred_at DESC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION ops.return_to_play_hold(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.return_to_play_hold(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION ops.attendance_respects_holds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_date  date;
  v_hold  uuid;
  v_name  text;
BEGIN
  IF NEW.status NOT IN ('present', 'late') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT date INTO v_date FROM ops.sessions WHERE id = NEW.session_id;
  v_hold := ops.return_to_play_hold(NEW.student_id, coalesce(v_date, current_date));
  IF v_hold IS NOT NULL THEN
    SELECT first_name INTO v_name FROM ops.students WHERE id = NEW.student_id;
    RAISE EXCEPTION '% can''t be marked here: a suspected concussion is on file and there is no written clearance to return yet. Mark them excused.', coalesce(v_name, 'This child')
      USING ERRCODE = 'P0001', HINT = 'return_to_play_hold';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.attendance_respects_holds() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS attendance_respects_holds ON ops.attendance;
CREATE TRIGGER attendance_respects_holds
  BEFORE INSERT OR UPDATE OF status ON ops.attendance
  FOR EACH ROW EXECUTE FUNCTION ops.attendance_respects_holds();
