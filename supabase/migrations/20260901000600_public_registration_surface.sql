-- ============================================================================
-- Public registration surface for the marketing site.
--
-- risingstars.training is a static SPA that ships only the anon key, and anon
-- has no USAGE on `ops`. Rather than loosen that, this migration exposes two
-- narrow objects in `public`:
--
--   * program_availability — aggregate seat counts, no PII
--   * submit_registration  — creates one registration and returns only the
--                            outcome; it cannot read anything back
--
-- Both run as owner, so anon reaches the operational data through exactly
-- these two doors and nothing else.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Link a CMS program to an operational one.
--
-- public.programs is the marketing listing ("Tennis Stars - Wylie"); ops.programs
-- is the thing with a roster and a 12-seat cap. Nullable on purpose: an unlinked
-- CMS row keeps its current hand-typed behaviour and nothing on the live site
-- changes until the link is set.
-- ----------------------------------------------------------------------------

ALTER TABLE public.programs
    ADD COLUMN IF NOT EXISTS ops_program_id uuid
    REFERENCES ops.programs (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.programs.ops_program_id IS
    'Links this marketing listing to the operational program that owns the roster and seat cap. Null means the listing still uses its hand-typed slots/price text.';

-- ----------------------------------------------------------------------------
-- 2. Aggregate availability, keyed by the CMS program id the site already has.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.program_availability AS
SELECT
    p.id                AS cms_program_id,
    o.id                AS ops_program_id,
    p.title,
    o.capacity,
    ops.seats_taken(o.id)                            AS seats_taken,
    GREATEST(o.capacity - ops.seats_taken(o.id), 0)  AS seats_remaining,
    o.registration_open,
    o.monthly_fee,
    (SELECT count(*) FROM ops.registrations r
      WHERE r.program_id = o.id AND r.status = 'waitlisted') AS waitlist_count
FROM public.programs p
JOIN ops.programs o ON o.id = p.ops_program_id;

GRANT SELECT ON public.program_availability TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Registration, callable by anon.
--
-- Returns only the outcome. A parent learns whether they got a seat and where
-- they sit on the waitlist — never another family's details.
--
-- The light per-phone throttle is there because this is an unauthenticated
-- write: a single number submitting more than ten times in an hour is a script,
-- not a family.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_registration(
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
RETURNS TABLE (status text, waitlist_position integer, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
    v_recent      integer;
    v_registration ops.registrations%ROWTYPE;
BEGIN
    SELECT count(*) INTO v_recent
      FROM ops.registrations
     WHERE parent_phone = p_parent_phone
       AND created_at > now() - interval '1 hour';

    IF v_recent >= 10 THEN
        RAISE EXCEPTION 'Too many registrations from this number. Please message us instead.';
    END IF;

    v_registration := ops.submit_registration(
        p_program_id,
        p_child_first_name,
        p_child_last_name,
        p_parent_first_name,
        p_parent_last_name,
        p_parent_phone,
        p_parent_email,
        p_child_grade,
        p_child_date_of_birth,
        p_medical_notes,
        p_how_heard
    );

    status            := v_registration.status;
    waitlist_position := v_registration.waitlist_position;
    amount            := v_registration.amount;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_registration(uuid, text, text, text, text, text, text, text, date, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_registration(uuid, text, text, text, text, text, text, text, date, text, text) TO anon, authenticated;
