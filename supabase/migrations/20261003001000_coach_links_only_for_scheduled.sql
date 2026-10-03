-- ============================================================================
-- A coach link only opens the register of a practice that is still on.
--
-- A cancelled practice opened in the coach's register and saved attendance for
-- a practice that never happened; cancelling now switches its links off too,
-- but the database is the place that has to refuse. Both open_attendance_sheet
-- and save_attendance_sheet go through this guard, so redefining it covers
-- both.
--
-- The check comes after the passcode, so someone without it cannot learn
-- whether a practice was cancelled.
-- ============================================================================

SET search_path = ops, public, extensions;

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
    v_link   ops.attendance_links%ROWTYPE;
    v_status text;
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

    SELECT status INTO v_status FROM ops.sessions WHERE id = v_link.session_id;

    IF v_status = 'cancelled' THEN
        err := 'This practice was cancelled, so there is no register to take.';
        RETURN;
    END IF;

    IF v_status IS DISTINCT FROM 'scheduled' THEN
        err := 'This practice is finished, so its register is closed.';
        RETURN;
    END IF;

    UPDATE ops.attendance_links
       SET failed_attempts = 0, locked_until = NULL, last_opened_at = now()
     WHERE id = v_link.id;

    link_id := v_link.id;
END;
$$;

-- Links already out for practices cancelled before this change.
UPDATE ops.attendance_links l
   SET revoked_at = now()
  FROM ops.sessions s
 WHERE s.id = l.session_id
   AND s.status = 'cancelled'
   AND l.revoked_at IS NULL;
