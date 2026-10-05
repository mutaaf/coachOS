-- ============================================================================
-- A linked listing's price, places, dates and place come from CoachOS.
--
-- When a listing was linked to a session, CoachOS copied the session's fee,
-- places, dates and location into the listing's text once, and every later
-- change in CoachOS silently drifted from it: the live site said "$150" for a
-- session billed at $120. The Website page no longer writes those fields for a
-- linked listing (it shows CoachOS's values, read-only); this keeps the
-- listing's copies — which the website's current code still reads, until it
-- moves to public.site_offerings — equal to CoachOS's, always:
--
--   * whenever a linked listing is saved, its price, slots, date_range,
--     start_date, end_date and location are recomputed from its session;
--   * whenever the session, its school's name or its season's dates change,
--     its listing is recomputed.
--
-- Unlinked listings are untouched. Existing linked listings are brought into
-- line once, here (the one linked listing on the live site had "150" for a
-- $120 session and 2025 dates).
-- ============================================================================

SET search_path = ops, public, extensions;

-- "$120/month", "$99.5/month" — as lib/website.ts listingFromProgram writes it.
CREATE OR REPLACE FUNCTION public.listing_price_text(p_fee numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '$' || rtrim(rtrim(to_char(p_fee, 'FM999,999,990.00'), '0'), '.') || '/month'
$$;

-- "September 8 – December 11, 2026" — as lib/website.ts dateRangeText writes it.
CREATE OR REPLACE FUNCTION public.listing_date_text(p_start date, p_end date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_start IS NULL AND p_end IS NULL THEN ''
    WHEN p_end IS NULL THEN 'Starts ' || to_char(p_start, 'FMMonth FMDD, YYYY')
    WHEN p_start IS NULL THEN 'Until ' || to_char(p_end, 'FMMonth FMDD, YYYY')
    WHEN extract(year FROM p_start) = extract(year FROM p_end)
      THEN to_char(p_start, 'FMMonth FMDD') || ' – ' || to_char(p_end, 'FMMonth FMDD, YYYY')
    ELSE to_char(p_start, 'FMMonth FMDD, YYYY') || ' – ' || to_char(p_end, 'FMMonth FMDD, YYYY')
  END
$$;

CREATE OR REPLACE FUNCTION public.listing_follows_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v record;
BEGIN
  IF NEW.ops_program_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.monthly_fee, o.capacity,
         coalesce(o.start_date, se.start_date) AS start_date,
         coalesce(o.end_date, se.end_date)     AS end_date,
         coalesce(nullif(btrim(o.location), ''), s.name, '') AS location
    INTO v
    FROM ops.programs o
    JOIN ops.schools s       ON s.id = o.school_id
    LEFT JOIN ops.seasons se ON se.id = o.season_id
   WHERE o.id = NEW.ops_program_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  NEW.price      := public.listing_price_text(v.monthly_fee);
  NEW.slots      := v.capacity || ' spots';
  NEW.start_date := v.start_date;
  NEW.end_date   := v.end_date;
  NEW.date_range := public.listing_date_text(v.start_date, v.end_date);
  NEW.location   := v.location;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.listing_follows_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS listing_follows_session ON public.programs;
CREATE TRIGGER listing_follows_session
  BEFORE INSERT OR UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.listing_follows_session();

-- Re-save the listings of the sessions that changed; the trigger above
-- recomputes them. updated_at is left as it was: nobody edited the listing.
CREATE OR REPLACE FUNCTION ops.refresh_linked_listings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'programs' THEN
    UPDATE public.programs l SET updated_at = l.updated_at WHERE l.ops_program_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'schools' THEN
    UPDATE public.programs l SET updated_at = l.updated_at
      FROM ops.programs o WHERE o.school_id = NEW.id AND l.ops_program_id = o.id;
  ELSIF TG_TABLE_NAME = 'seasons' THEN
    UPDATE public.programs l SET updated_at = l.updated_at
      FROM ops.programs o WHERE o.season_id = NEW.id AND l.ops_program_id = o.id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.refresh_linked_listings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refresh_linked_listings ON ops.programs;
CREATE TRIGGER refresh_linked_listings
  AFTER UPDATE OF monthly_fee, capacity, start_date, end_date, location, school_id, season_id ON ops.programs
  FOR EACH ROW EXECUTE FUNCTION ops.refresh_linked_listings();

DROP TRIGGER IF EXISTS refresh_linked_listings ON ops.schools;
CREATE TRIGGER refresh_linked_listings
  AFTER UPDATE OF name ON ops.schools
  FOR EACH ROW EXECUTE FUNCTION ops.refresh_linked_listings();

DROP TRIGGER IF EXISTS refresh_linked_listings ON ops.seasons;
CREATE TRIGGER refresh_linked_listings
  AFTER UPDATE OF start_date, end_date ON ops.seasons
  FOR EACH ROW EXECUTE FUNCTION ops.refresh_linked_listings();

-- Bring the existing linked listings into line.
UPDATE public.programs SET updated_at = updated_at WHERE ops_program_id IS NOT NULL;
