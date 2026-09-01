-- ============================================================================
-- Coaches, seat capacity, and public registrations.
--
-- Three gaps between the original schema and how the business actually runs:
--   1. Contractor coaches did not exist as records, so nobody could be
--      assigned to a session and no one tracked what they were owed.
--   2. Sessions had no seat cap, so the "12 kids max" rule and the waitlist
--      it produces lived only in WhatsApp.
--   3. There was no inbound registration, so every signup arrived as a
--      message and was re-typed by hand.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Coaches
-- ----------------------------------------------------------------------------

CREATE TABLE coaches (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name   text          NOT NULL,
    last_name    text          NOT NULL,
    phone        text          NOT NULL,
    email        text,
    status       text          NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'inactive', 'prospective')),
    pay_rate     numeric(10,2),
    pay_type     text          NOT NULL DEFAULT 'per_session'
                               CHECK (pay_type IN ('per_session', 'hourly')),
    -- Where the coach came from; most arrive via Facebook Marketplace or referral.
    source       text,
    notes        text,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX coaches_status_idx ON coaches (status);

-- The coach normally scheduled for a weekly slot...
ALTER TABLE schedule_templates ADD COLUMN coach_id uuid REFERENCES coaches (id) ON DELETE SET NULL;
-- ...and the coach who actually ran a given session, which is what gets paid.
ALTER TABLE sessions           ADD COLUMN coach_id uuid REFERENCES coaches (id) ON DELETE SET NULL;

CREATE INDEX schedule_templates_coach_idx ON schedule_templates (coach_id);
CREATE INDEX sessions_coach_idx           ON sessions (coach_id);

-- ----------------------------------------------------------------------------
-- 2. Capacity and public listing on programs
-- ----------------------------------------------------------------------------

ALTER TABLE programs ADD COLUMN capacity integer NOT NULL DEFAULT 12
    CHECK (capacity > 0);
ALTER TABLE programs ADD COLUMN registration_open boolean NOT NULL DEFAULT false;
-- Stable, shareable identifier for the public registration link.
ALTER TABLE programs ADD COLUMN public_slug text UNIQUE;
ALTER TABLE programs ADD COLUMN public_description text;
-- Where the sessions physically happen, shown on the registration page.
ALTER TABLE programs ADD COLUMN location text;

-- ----------------------------------------------------------------------------
-- 3. Registrations
--
-- A registration is inbound intake and is deliberately separate from an
-- enrollment. It holds what a parent typed before any of it has been reconciled
-- into student/parent records, and it survives being declined or waitlisted.
-- ----------------------------------------------------------------------------

CREATE TABLE registrations (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id          uuid        NOT NULL REFERENCES programs (id) ON DELETE CASCADE,

    status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'confirmed', 'waitlisted',
                                                      'cancelled', 'declined')),

    -- What the parent typed. Kept verbatim even after conversion.
    child_first_name    text        NOT NULL,
    child_last_name     text        NOT NULL,
    child_grade         text,
    child_date_of_birth date,
    parent_first_name   text        NOT NULL,
    parent_last_name    text        NOT NULL,
    parent_phone        text        NOT NULL,
    parent_email        text,
    medical_notes       text,
    how_heard           text,

    -- Set once the registration is reconciled into real records.
    student_id          uuid        REFERENCES students (id)    ON DELETE SET NULL,
    parent_id           uuid        REFERENCES parents (id)     ON DELETE SET NULL,
    enrollment_id       uuid        REFERENCES enrollments (id) ON DELETE SET NULL,

    -- Position in line when status = 'waitlisted'; null otherwise.
    waitlist_position   integer,

    amount              numeric(10,2),
    payment_status      text        NOT NULL DEFAULT 'unpaid'
                                    CHECK (payment_status IN ('unpaid', 'paid', 'refunded', 'waived')),
    stripe_checkout_session_id text,

    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX registrations_program_idx  ON registrations (program_id);
CREATE INDEX registrations_status_idx   ON registrations (status);
CREATE INDEX registrations_phone_idx    ON registrations (parent_phone);
CREATE INDEX registrations_created_idx  ON registrations (created_at DESC);

CREATE TRIGGER registrations_updated_at
    BEFORE UPDATE ON registrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER coaches_updated_at
    BEFORE UPDATE ON coaches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. Seat accounting
--
-- A seat is held either by an active enrollment, or by a confirmed
-- registration that has not been converted into one yet. Counting both, with
-- the second qualified on enrollment_id IS NULL, avoids double-counting a
-- registration and the enrollment it became.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seats_taken(p_program_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
    SELECT (
        (SELECT count(*) FROM enrollments e
          WHERE e.program_id = p_program_id AND e.status = 'active')
      + (SELECT count(*) FROM registrations r
          WHERE r.program_id = p_program_id
            AND r.status = 'confirmed'
            AND r.enrollment_id IS NULL)
    )::integer;
$$;

-- Aggregate availability only. No child or parent data appears here, which is
-- what makes it safe to surface publicly.
CREATE OR REPLACE VIEW program_availability AS
SELECT
    p.id                AS program_id,
    p.public_slug,
    p.name,
    p.location,
    p.public_description,
    p.season,
    p.start_date,
    p.end_date,
    p.monthly_fee,
    p.capacity,
    p.registration_open,
    s.name              AS school_name,
    seats_taken(p.id)                            AS seats_taken,
    GREATEST(p.capacity - seats_taken(p.id), 0)  AS seats_remaining,
    (SELECT count(*) FROM registrations r
      WHERE r.program_id = p.id AND r.status = 'waitlisted') AS waitlist_count
FROM programs p
JOIN schools s ON s.id = p.school_id
WHERE p.status IN ('active', 'upcoming');

-- ----------------------------------------------------------------------------
-- 5. Atomic registration
--
-- Two parents can submit for the last seat at the same moment. Locking the
-- program row serialises the capacity check so the cap cannot be oversold, and
-- the loser is waitlisted rather than rejected.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION submit_registration(
    p_program_id          uuid,
    p_child_first_name    text,
    p_child_last_name     text,
    p_parent_first_name   text,
    p_parent_last_name    text,
    p_parent_phone        text,
    p_parent_email        text    DEFAULT NULL,
    p_child_grade         text    DEFAULT NULL,
    p_child_date_of_birth date    DEFAULT NULL,
    p_medical_notes       text    DEFAULT NULL,
    p_how_heard           text    DEFAULT NULL
)
RETURNS registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
    v_program     programs%ROWTYPE;
    v_taken       integer;
    v_status      text;
    v_position    integer;
    v_registration registrations%ROWTYPE;
BEGIN
    -- Serialise concurrent submissions for this program.
    SELECT * INTO v_program FROM programs WHERE id = p_program_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Program % not found', p_program_id;
    END IF;

    IF NOT v_program.registration_open THEN
        RAISE EXCEPTION 'Registration is closed for %', v_program.name;
    END IF;

    v_taken := seats_taken(p_program_id);

    IF v_taken < v_program.capacity THEN
        v_status   := 'confirmed';
        v_position := NULL;
    ELSE
        v_status := 'waitlisted';
        SELECT coalesce(max(waitlist_position), 0) + 1
          INTO v_position
          FROM registrations
         WHERE program_id = p_program_id AND status = 'waitlisted';
    END IF;

    INSERT INTO registrations (
        program_id, status,
        child_first_name, child_last_name, child_grade, child_date_of_birth,
        parent_first_name, parent_last_name, parent_phone, parent_email,
        medical_notes, how_heard, waitlist_position, amount
    ) VALUES (
        p_program_id, v_status,
        p_child_first_name, p_child_last_name, p_child_grade, p_child_date_of_birth,
        p_parent_first_name, p_parent_last_name, p_parent_phone, p_parent_email,
        p_medical_notes, p_how_heard, v_position, v_program.monthly_fee
    )
    RETURNING * INTO v_registration;

    RETURN v_registration;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RLS — same posture as the rest of the schema: authenticated only.
--    Public registration traffic never touches these directly; it goes through
--    a server action holding the service role.
-- ----------------------------------------------------------------------------

ALTER TABLE coaches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select coaches"
    ON coaches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert coaches"
    ON coaches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update coaches"
    ON coaches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete coaches"
    ON coaches FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can select registrations"
    ON registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert registrations"
    ON registrations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update registrations"
    ON registrations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete registrations"
    ON registrations FOR DELETE TO authenticated USING (true);

GRANT ALL ON ALL TABLES    IN SCHEMA ops TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ops TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ops TO authenticated, service_role;
