-- ============================================================================
-- Children's medical notes: only the people who need them, and on the record.
--
-- Who can see a child's medical note and date of birth:
--   * admins, through the dashboard (RLS on ops.students and
--     ops.registrations already requires ops.is_admin(); tested);
--   * the coach assigned to the child's practice, through that practice's
--     passcode-protected register — and nobody else holding a register link.
--
-- Coaches have no accounts (20260902000100), so "assigned" is decided by the
-- link: a register link now records the coach it was issued to, and the
-- register shows medical notes only when that coach is the practice's coach
-- or the program's weekly-slot coach. A link issued before this change (no
-- coach on it) shows them only while the practice has an assigned coach.
-- Anyone else sees that a note exists — "ask the Boss before practice" — but
-- not what it says. Dates of birth never reach the register.
--
-- Every time a register shows medical notes, one audit row records the link,
-- the coach and the children whose notes were shown. Dashboard views are
-- logged by the app (lib/audit.ts).
--
-- The register also says which children have no photo release (don't post
-- them) and which are sitting out pending a concussion clearance; saving a
-- register that marks one of those present is refused with a plain message.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE ops.attendance_links
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES ops.coaches (id) ON DELETE SET NULL;

COMMENT ON COLUMN ops.attendance_links.coach_id IS
  'The coach this register link was issued to. Medical notes are shown only when they are assigned to the practice.';

-- Whether this link's holder may read medical notes for its practice.
CREATE OR REPLACE FUNCTION ops.link_may_see_medical(p_link_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM ops.attendance_links l
      JOIN ops.sessions s ON s.id = l.session_id
     WHERE l.id = p_link_id
       AND (
         -- Issued to the coach running it, or to the program's regular coach.
         (l.coach_id IS NOT NULL AND (
             l.coach_id = s.coach_id
          OR EXISTS (SELECT 1 FROM ops.schedule_templates t WHERE t.program_id = s.program_id AND t.coach_id = l.coach_id)))
         -- Older links: whoever the practice's assigned coach is.
      OR (l.coach_id IS NULL AND (
             s.coach_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM ops.schedule_templates t WHERE t.program_id = s.program_id AND t.coach_id IS NOT NULL)))
       )
  )
$$;

REVOKE ALL ON FUNCTION ops.link_may_see_medical(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.link_may_see_medical(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.open_attendance_sheet(p_token text, p_passcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
    v_auth       record;
    v_session_id uuid;
    v_session    record;
    v_roster     jsonb;
    v_medical    boolean;
    v_link       ops.attendance_links%ROWTYPE;
    v_shown      uuid[];
BEGIN
    SELECT * INTO v_auth FROM ops.authorise_attendance_link(p_token, p_passcode);
    IF v_auth.err IS NOT NULL THEN
        RETURN jsonb_build_object('error', v_auth.err);
    END IF;
    SELECT * INTO v_link FROM ops.attendance_links WHERE id = v_auth.link_id;
    v_session_id := v_link.session_id;
    v_medical := ops.link_may_see_medical(v_link.id);

    SELECT s.id, s.date, s.start_time, s.end_time, s.status,
           p.name AS program_name, sc.name AS school_name, st.location
      INTO v_session
      FROM ops.sessions s
      JOIN ops.programs p  ON p.id = s.program_id
      JOIN ops.schools  sc ON sc.id = p.school_id
      LEFT JOIN ops.schedule_templates st ON st.id = s.schedule_template_id
     WHERE s.id = v_session_id;

    SELECT coalesce(jsonb_agg(child ORDER BY child->>'first_name'), '[]'::jsonb),
           array_agg(sid) FILTER (WHERE shown)
      INTO v_roster, v_shown
      FROM (
        SELECT stu.id AS sid,
               (v_medical AND nullif(btrim(stu.medical_notes), '') IS NOT NULL) AS shown,
               jsonb_build_object(
                 'student_id',       stu.id,
                 'first_name',       stu.first_name,
                 'last_name',        stu.last_name,
                 'medical_notes',    CASE WHEN v_medical THEN stu.medical_notes END,
                 'has_medical_note', nullif(btrim(stu.medical_notes), '') IS NOT NULL,
                 'photo_ok',         coalesce(stu.photo_release, false),
                 'sitting_out',      ops.return_to_play_hold(stu.id, v_session.date) IS NOT NULL,
                 'status',           att.status
               ) AS child
          FROM ops.enrollments e
          JOIN ops.students stu ON stu.id = e.student_id
          LEFT JOIN ops.attendance att
                 ON att.session_id = v_session_id AND att.student_id = stu.id
         WHERE e.program_id = (SELECT program_id FROM ops.sessions WHERE id = v_session_id)
           AND e.status = 'active'
      ) rows;

    IF cardinality(v_shown) > 0 THEN
        PERFORM ops.audit('coach_link:' || v_link.id::text, 'medical.view', 'session', v_session_id,
                          jsonb_build_object('surface', 'coach_register', 'coach_id', v_link.coach_id,
                                             'student_ids', to_jsonb(v_shown)));
    END IF;

    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'date',         v_session.date,
            'start_time',   v_session.start_time,
            'end_time',     v_session.end_time,
            'status',       v_session.status,
            'program_name', v_session.program_name,
            'school_name',  v_session.school_name,
            'location',     v_session.location
        ),
        'medical_visible', v_medical,
        'roster', v_roster
    );
END;
$$;

-- Same as 20260902000100, plus: every record is checked before any is
-- written, and a child sitting out after a suspected concussion can't be
-- marked here or late. (The attendance trigger refuses it too; this turns it
-- into a message the coach can read instead of a failed save.)
CREATE OR REPLACE FUNCTION public.save_attendance_sheet(
    p_token    text,
    p_passcode text,
    p_records  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
    v_auth       record;
    v_session_id uuid;
    v_date       date;
    v_saved      integer := 0;
    v_record     jsonb;
    v_student    uuid;
    v_status     text;
    v_name       text;
BEGIN
    SELECT * INTO v_auth FROM ops.authorise_attendance_link(p_token, p_passcode);
    IF v_auth.err IS NOT NULL THEN
        RETURN jsonb_build_object('error', v_auth.err);
    END IF;
    SELECT session_id INTO v_session_id FROM ops.attendance_links WHERE id = v_auth.link_id;
    SELECT date INTO v_date FROM ops.sessions WHERE id = v_session_id;

    IF jsonb_typeof(p_records) <> 'array' THEN
        RETURN jsonb_build_object('error', 'Nothing to save.');
    END IF;

    FOR v_record IN SELECT jsonb_array_elements(p_records) LOOP
        v_student := (v_record->>'student_id')::uuid;
        v_status  := v_record->>'status';

        IF v_status NOT IN ('present', 'absent', 'late', 'excused') THEN
            RETURN jsonb_build_object('error', format('Unknown attendance status: %s', v_status));
        END IF;

        -- Scope check: this token opens one session's register, nothing wider.
        IF NOT EXISTS (
            SELECT 1
              FROM ops.enrollments e
              JOIN ops.sessions s ON s.program_id = e.program_id
             WHERE s.id = v_session_id
               AND e.student_id = v_student
               AND e.status = 'active'
        ) THEN
            RETURN jsonb_build_object('error', 'That child is not on this session''s roster.');
        END IF;

        IF v_status IN ('present', 'late') AND ops.return_to_play_hold(v_student, v_date) IS NOT NULL THEN
            SELECT first_name INTO v_name FROM ops.students WHERE id = v_student;
            RETURN jsonb_build_object('error', format(
                '%s is sitting out until a doctor''s note clears them to play. Mark them excused and save again.', v_name));
        END IF;
    END LOOP;

    FOR v_record IN SELECT jsonb_array_elements(p_records) LOOP
        v_student := (v_record->>'student_id')::uuid;
        v_status  := v_record->>'status';

        INSERT INTO ops.attendance (session_id, student_id, status, checked_in_at)
        VALUES (
            v_session_id,
            v_student,
            v_status,
            CASE WHEN v_status IN ('present', 'late') THEN now() END
        )
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status, checked_in_at = EXCLUDED.checked_in_at;

        v_saved := v_saved + 1;
    END LOOP;

    RETURN jsonb_build_object('saved', v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.open_attendance_sheet(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_attendance_sheet(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_attendance_sheet(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_attendance_sheet(text, text, jsonb) TO anon, authenticated;
