-- ============================================================================
-- Keep personal data only as long as it is needed.
--
-- A nightly job (/api/cron/retention → lib/retention.ts) calls
-- ops.run_retention with the periods set in code, by default:
--
--   * website inquiries older than 24 months: contact details and message
--     removed (the row, its kind and dates stay for the numbers);
--   * registrations that never became a place — declined, cancelled, or a
--     waitlist that never cleared — untouched for 24 months: the child's and
--     parent's details removed, the amount and status kept;
--   * medical notes of children with no active enrollment for 12 months:
--     removed from the child and from their registrations;
--   * privacy requests older than 36 months: requester's contact details
--     removed; the request, its dates and outcome stay as the record.
--
-- Never touched: invoices and payments (IRS record keeping), incident reports
-- (kept while a claim could be brought), the audit and consent logs.
--
-- p_dry_run counts what would change and changes nothing. Every run, dry or
-- not, leaves an audit row with the counts.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. When a child left a program.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.enrollments ADD COLUMN IF NOT EXISTS ended_at timestamptz;

COMMENT ON COLUMN ops.enrollments.ended_at IS 'When the enrollment stopped being active (withdrawn or completed). Null while active.';

CREATE OR REPLACE FUNCTION ops.enrollment_ended_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    NEW.ended_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.status = 'active' THEN
    NEW.ended_at := coalesce(NEW.ended_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollments_ended_at ON ops.enrollments;
CREATE TRIGGER enrollments_ended_at
  BEFORE INSERT OR UPDATE OF status ON ops.enrollments
  FOR EACH ROW EXECUTE FUNCTION ops.enrollment_ended_at();

-- Enrollments that ended before this column existed: the last practice the
-- child was marked at, or when they enrolled.
UPDATE ops.enrollments e
   SET ended_at = coalesce(
         (SELECT max(s.date)::timestamptz FROM ops.attendance a JOIN ops.sessions s ON s.id = a.session_id
           WHERE a.student_id = e.student_id AND s.program_id = e.program_id),
         e.enrolled_at)
 WHERE e.status <> 'active' AND e.ended_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. The job.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.run_retention(
  p_dry_run                boolean DEFAULT true,
  p_inquiry_months         integer DEFAULT 24,
  p_registration_months    integer DEFAULT 24,
  p_medical_months         integer DEFAULT 12,
  p_privacy_request_months integer DEFAULT 36,
  p_now                    timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inquiries  uuid[];
  v_privacy    uuid[];
  v_regs       uuid[];
  v_students   uuid[];
  v_result     jsonb;
BEGIN
  IF least(p_inquiry_months, p_registration_months, p_medical_months, p_privacy_request_months) < 1 THEN
    RAISE EXCEPTION 'Retention periods must be at least a month.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_inquiries
    FROM ops.inquiries
   WHERE kind <> 'privacy_request'
     AND anonymized_at IS NULL
     AND created_at < p_now - make_interval(months => p_inquiry_months);

  SELECT coalesce(array_agg(id), '{}') INTO v_privacy
    FROM ops.inquiries
   WHERE kind = 'privacy_request'
     AND anonymized_at IS NULL
     AND privacy_status IN ('completed', 'denied', 'appeal_granted', 'appeal_denied')
     AND created_at < p_now - make_interval(months => p_privacy_request_months);

  SELECT coalesce(array_agg(id), '{}') INTO v_regs
    FROM ops.registrations
   WHERE status IN ('declined', 'cancelled', 'waitlisted')
     AND enrollment_id IS NULL
     AND anonymized_at IS NULL
     AND updated_at < p_now - make_interval(months => p_registration_months);

  -- Children with a medical note and no active place, whose last activity —
  -- leaving a program, a practice attended, enrolling, being added — is older
  -- than the period.
  SELECT coalesce(array_agg(st.id), '{}') INTO v_students
    FROM ops.students st
   WHERE (nullif(btrim(st.medical_notes), '') IS NOT NULL
          OR EXISTS (SELECT 1 FROM ops.registrations r WHERE r.student_id = st.id AND nullif(btrim(r.medical_notes), '') IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM ops.enrollments e WHERE e.student_id = st.id AND e.status = 'active')
     AND greatest(
           st.created_at,
           (SELECT max(coalesce(e.ended_at, e.enrolled_at)) FROM ops.enrollments e WHERE e.student_id = st.id),
           (SELECT max(s.date)::timestamptz FROM ops.attendance a JOIN ops.sessions s ON s.id = a.session_id WHERE a.student_id = st.id)
         ) < p_now - make_interval(months => p_medical_months);

  v_result := jsonb_build_object(
    'dry_run', p_dry_run,
    'inquiries', cardinality(v_inquiries),
    'privacy_requests', cardinality(v_privacy),
    'registrations', cardinality(v_regs),
    'medical_notes', cardinality(v_students),
    'periods_months', jsonb_build_object('inquiries', p_inquiry_months, 'registrations', p_registration_months,
                                         'medical_notes', p_medical_months, 'privacy_requests', p_privacy_request_months)
  );

  IF NOT p_dry_run THEN
    UPDATE ops.inquiries
       SET first_name = NULL, last_name = NULL, phone = NULL, email = NULL, message = NULL,
           child_ages = NULL, notes = NULL, organization = NULL, attribution = NULL, details = NULL, anonymized_at = p_now
     WHERE id = ANY (v_inquiries);

    UPDATE ops.inquiries
       SET first_name = NULL, last_name = NULL, phone = NULL, email = NULL, message = NULL,
           child_first_names = '{}', notes = NULL, attribution = NULL, details = NULL, anonymized_at = p_now
     WHERE id = ANY (v_privacy);

    UPDATE ops.registrations
       SET child_first_name = 'Removed', child_last_name = '(retention)', child_grade = NULL, child_date_of_birth = NULL,
           parent_first_name = 'Removed', parent_last_name = '(retention)', parent_phone = 'removed', parent_email = NULL,
           medical_notes = NULL, how_heard = NULL, notes = NULL, attribution = NULL, anonymized_at = p_now
     WHERE id = ANY (v_regs);

    UPDATE ops.students SET medical_notes = NULL WHERE id = ANY (v_students) AND medical_notes IS NOT NULL;
    UPDATE ops.registrations SET medical_notes = NULL WHERE student_id = ANY (v_students) AND medical_notes IS NOT NULL;
  END IF;

  PERFORM ops.audit('system:retention', CASE WHEN p_dry_run THEN 'retention.dry_run' ELSE 'retention.run' END,
                    NULL, NULL, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION ops.run_retention(boolean, integer, integer, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.run_retention(boolean, integer, integer, integer, integer, timestamptz) TO service_role;
