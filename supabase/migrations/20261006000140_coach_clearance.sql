-- ============================================================================
-- Coach safeguarding: who is cleared to be alone with children.
--
-- Before a coach runs a practice the academy needs, on file:
--   * a criminal background check that includes the sex-offender registry,
--     renewed every year (the standard Texas sets for youth camps, 25 TAC
--     §265.12; school districts may also require a fingerprint check of a
--     contractor's staff, Educ. Code §22.0834);
--   * abuse-prevention training (child sexual abuse and molestation
--     awareness), renewed every two years (Health & Safety Code §141.0095);
--   * a current CPR / First Aid certificate;
--   * a signed code of conduct.
--
-- The rules for "cleared", "expiring" and "missing" live in
-- lib/coach-clearance.ts so the coach page, the dashboard and the assignment
-- screens all say the same thing. The database only keeps the facts.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE ops.coaches
  ADD COLUMN IF NOT EXISTS background_check_date        date,
  ADD COLUMN IF NOT EXISTS background_check_provider    text,
  ADD COLUMN IF NOT EXISTS background_check_sex_offender_registry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS background_check_fingerprint boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abuse_training_date          date,
  ADD COLUMN IF NOT EXISTS abuse_training_expires_on    date,
  ADD COLUMN IF NOT EXISTS cpr_first_aid_expires_on     date,
  ADD COLUMN IF NOT EXISTS code_of_conduct_signed_on    date,
  ADD COLUMN IF NOT EXISTS safeguarding_notes           text;

COMMENT ON COLUMN ops.coaches.background_check_date IS 'Date the most recent criminal background check came back clear.';
COMMENT ON COLUMN ops.coaches.background_check_sex_offender_registry IS 'Whether that check included the sex-offender registry (state and national).';
COMMENT ON COLUMN ops.coaches.background_check_fingerprint IS 'Whether it was a fingerprint-based check (what school districts require of contractors, Educ. Code §22.0834).';
COMMENT ON COLUMN ops.coaches.abuse_training_expires_on IS 'When the abuse-prevention certificate runs out. Blank: two years after the training date.';
