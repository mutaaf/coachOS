-- ============================================================================
-- Where each registration came from.
--
-- The website captures the visit that brought a family (UTM tags, Google and
-- Facebook click ids, referrer, landing page) and its GA ids, and sends them
-- with the registration. Kept here, cleaned to the agreed keys by
-- ops.clean_attribution, so the Registrations page can say "google / cpc ·
-- fall" and a paid family can later be credited to the campaign that found
-- them. how_heard stays as the parent's own answer.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE ops.registrations ADD COLUMN IF NOT EXISTS attribution jsonb;

COMMENT ON COLUMN ops.registrations.attribution IS
  'Where the family came from, as the website captured it: {first_touch, last_touch, ga_client_id, ga_session_id}. See ops.clean_attribution.';
