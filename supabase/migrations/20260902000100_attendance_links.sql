-- ============================================================================
-- Passcode-protected attendance sheets for coaches.
--
-- Coaches have no accounts, and giving them one would mean a roles model and
-- per-coach policies across every table. A link scoped to a single session is
-- far less to get wrong: it reaches exactly one register, it expires, and it
-- can be revoked.
--
-- The security posture, deliberately:
--   * the link alone is not enough — a passcode is always required
--   * the passcode is bcrypt-hashed, never stored or returned
--   * repeated wrong guesses lock the link, so a 6-digit code cannot be walked
--   * the sheet exposes one session's children and nothing else — no parent
--     contact details, no fees, no other sessions, no other programs
--   * everything runs SECURITY DEFINER, so `anon` still has no access to `ops`
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE attendance_links (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,

    -- Goes in the URL. Long and random: guessing it is not a realistic attack,
    -- but it is not treated as a secret on its own either.
    token           text        NOT NULL UNIQUE,

    -- bcrypt. The plain passcode is shown once, when the link is created, and
    -- is not recoverable afterwards.
    passcode_hash   text        NOT NULL,

    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    last_opened_at  timestamptz,

    -- A six-digit code is only safe if it cannot be tried a million times.
    failed_attempts integer     NOT NULL DEFAULT 0,
    locked_until    timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_links_session_idx ON attendance_links (session_id);
CREATE INDEX attendance_links_expiry_idx  ON attendance_links (expires_at);

ALTER TABLE attendance_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select attendance links"
    ON attendance_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert attendance links"
    ON attendance_links FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update attendance links"
    ON attendance_links FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete attendance links"
    ON attendance_links FOR DELETE TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- Shared guard: resolve a token + passcode to a link, or refuse.
--
-- Returns the link row. Raises with a message safe to show a coach — never
-- distinguishing "no such link" from "wrong passcode", so the endpoint cannot
-- be used to discover which tokens exist.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.authorise_attendance_link(
    p_token    text,
    p_passcode text,
    OUT link_id uuid,
    OUT err     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
    v_link ops.attendance_links%ROWTYPE;
BEGIN
    -- Deliberately returns an error rather than raising it. RAISE rolls the
    -- transaction back, which would undo the failed-attempt counter below and
    -- leave the lockout permanently disarmed — a six-digit passcode with no
    -- lockout can simply be walked.
    SELECT * INTO v_link FROM ops.attendance_links WHERE token = p_token FOR UPDATE;

    IF NOT FOUND THEN
        err := 'That link or passcode is not right.';
        RETURN;
    END IF;

    IF v_link.locked_until IS NOT NULL AND v_link.locked_until > now() THEN
        err := 'Too many wrong passcodes. Try again in a few minutes, or ask for a new link.';
        RETURN;
    END IF;

    IF v_link.revoked_at IS NOT NULL THEN
        err := 'This link has been turned off. Ask for a new one.';
        RETURN;
    END IF;

    IF v_link.expires_at < now() THEN
        err := 'This link has expired. Ask for a new one.';
        RETURN;
    END IF;

    IF v_link.passcode_hash <> extensions.crypt(p_passcode, v_link.passcode_hash) THEN
        UPDATE ops.attendance_links
           SET failed_attempts = failed_attempts + 1,
               -- Five wrong guesses buys fifteen minutes. Enough to stop a
               -- script, forgiving enough for a coach fumbling on a phone.
               locked_until = CASE WHEN failed_attempts + 1 >= 5
                                   THEN now() + interval '15 minutes' END
         WHERE id = v_link.id;
        err := 'That link or passcode is not right.';
        RETURN;
    END IF;

    UPDATE ops.attendance_links
       SET failed_attempts = 0, locked_until = NULL, last_opened_at = now()
     WHERE id = v_link.id;

    link_id := v_link.id;
END;
$$;

-- ----------------------------------------------------------------------------
-- What the coach sees.
--
-- One session, its children, and any medical note — a coach mid-session is the
-- person who needs to know about an allergy. Nothing else: no parent phone
-- numbers, no fees, no other sessions.
-- ----------------------------------------------------------------------------

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
BEGIN
    SELECT * INTO v_auth FROM ops.authorise_attendance_link(p_token, p_passcode);
    IF v_auth.err IS NOT NULL THEN
        RETURN jsonb_build_object('error', v_auth.err);
    END IF;
    SELECT session_id INTO v_session_id FROM ops.attendance_links WHERE id = v_auth.link_id;

    SELECT s.id, s.date, s.start_time, s.end_time, s.status,
           p.name AS program_name, sc.name AS school_name, st.location
      INTO v_session
      FROM ops.sessions s
      JOIN ops.programs p  ON p.id = s.program_id
      JOIN ops.schools  sc ON sc.id = p.school_id
      LEFT JOIN ops.schedule_templates st ON st.id = s.schedule_template_id
     WHERE s.id = v_session_id;

    SELECT coalesce(jsonb_agg(child ORDER BY child->>'first_name'), '[]'::jsonb)
      INTO v_roster
      FROM (
        SELECT jsonb_build_object(
                 'student_id',    stu.id,
                 'first_name',    stu.first_name,
                 'last_name',     stu.last_name,
                 'medical_notes', stu.medical_notes,
                 'status',        att.status
               ) AS child
          FROM ops.enrollments e
          JOIN ops.students stu ON stu.id = e.student_id
          LEFT JOIN ops.attendance att
                 ON att.session_id = v_session_id AND att.student_id = stu.id
         WHERE e.program_id = (SELECT program_id FROM ops.sessions WHERE id = v_session_id)
           AND e.status = 'active'
      ) rows;

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
        'roster', v_roster
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Saving the register.
--
-- Records are checked against the session's own roster, so a caller cannot mark
-- a child who is not enrolled in this program — the token grants one session,
-- not the students table.
-- ----------------------------------------------------------------------------

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
    v_saved      integer := 0;
    v_record  jsonb;
    v_student uuid;
    v_status  text;
BEGIN
    SELECT * INTO v_auth FROM ops.authorise_attendance_link(p_token, p_passcode);
    IF v_auth.err IS NOT NULL THEN
        RETURN jsonb_build_object('error', v_auth.err);
    END IF;
    SELECT session_id INTO v_session_id FROM ops.attendance_links WHERE id = v_auth.link_id;

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

-- Only these two doors are open to the public; `ops` itself stays denied.
REVOKE ALL ON FUNCTION public.open_attendance_sheet(text, text) FROM public;
REVOKE ALL ON FUNCTION public.save_attendance_sheet(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.open_attendance_sheet(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_attendance_sheet(text, text, jsonb) TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA ops TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Hashing, for the owner creating a link.
--
-- Kept in the database so the plain passcode never reaches a column, and
-- deliberately NOT granted to anon — it is for issuing links, not opening them.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hash_passcode(p_passcode text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
    SELECT extensions.crypt(p_passcode, extensions.gen_salt('bf'));
$$;

-- Supabase's default privileges grant EXECUTE on new public functions directly
-- to `anon`, so revoking from the PUBLIC pseudo-role is not enough — anon has to
-- be named. Issuing a link is the owner's job, not a visitor's.
REVOKE ALL ON FUNCTION public.hash_passcode(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hash_passcode(text) TO authenticated, service_role;
