-- ============================================================================
-- public.site_offerings — what the website lists, read from CoachOS.
--
-- The website used to type each program's price, places, dates and location
-- into its own listing (public.programs), and those copies drifted from what
-- CoachOS actually charges and holds (a listing said $150 while CoachOS billed
-- $120). From here the website reads one row per session straight from the
-- operational tables, and a listing becomes a marketing overlay on top: its
-- title, words, picture, ordering and SEO — never the price or the places.
--
-- Contract (docs/WEBSITE_CONTRACT.md, pinned by
-- tests/integration/website-contract.test.ts):
--
--   * One row per session (ops.programs) that is active or upcoming and
--     published: a linked listing decides with its `published` flag; a
--     session with no listing is on the site while its registration is open
--     (which is when CoachOS's own /join page takes sign-ups for it anyway).
--   * An explicit column list. The view runs with its owner's rights so anon
--     can read it without any access to `ops`; a column added here is public
--     the moment it is applied. Never SELECT * from ops into it. Never expose
--     whatsapp_group_url, notes, a coach's phone or pay, or anything about a
--     family or child.
--
-- public.program_availability stays exactly as it is (a deprecated alias)
-- until the website has moved over.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ----------------------------------------------------------------------------
-- 1. The listing becomes an overlay. Additive, with defaults that keep every
--    listing showing as it does today.
-- ----------------------------------------------------------------------------

ALTER TABLE public.programs
    ADD COLUMN IF NOT EXISTS published       boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS featured        boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sort_order      integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS slug            text,
    ADD COLUMN IF NOT EXISTS seo_title       text,
    ADD COLUMN IF NOT EXISTS seo_description text;

-- A slug is a web address: lower-case words joined by hyphens, one listing each.
ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_slug_format;
ALTER TABLE public.programs ADD CONSTRAINT programs_slug_format
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX IF NOT EXISTS programs_slug_key ON public.programs (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS programs_ops_program_id ON public.programs (ops_program_id);

COMMENT ON COLUMN public.programs.published IS
    'Whether a linked session is listed on the website (public.site_offerings). Unlinked listings are unaffected.';
COMMENT ON COLUMN public.programs.featured IS 'Highlighted by the website.';
COMMENT ON COLUMN public.programs.sort_order IS 'Lower first on the website.';
COMMENT ON COLUMN public.programs.slug IS
    'Optional web address for the listing; when empty the website uses the session''s CoachOS public_slug.';

-- ----------------------------------------------------------------------------
-- 2. The view.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.site_offerings AS
SELECT
    o.id                                                         AS offering_id,
    l.id                                                         AS cms_program_id,
    coalesce(nullif(btrim(l.slug), ''), o.public_slug)           AS public_slug,
    coalesce(nullif(btrim(l.title), ''), o.name)                 AS title,
    coalesce(nullif(btrim(l.description), ''),
             nullif(btrim(o.public_description), ''),
             nullif(btrim(c.description), ''))                   AS description,
    coalesce(nullif(btrim(l.image), ''), nullif(btrim(c.image), '')) AS image_url,
    c.sport                                                      AS sport,
    coalesce(nullif(l.age_groups, '{}'), c.age_groups, '{}'::text[]) AS age_groups,
    coalesce(se.name, nullif(btrim(o.season), ''))               AS season_name,
    coalesce(o.start_date, se.start_date)                        AS start_date,
    coalesce(o.end_date, se.end_date)                            AS end_date,
    o.monthly_fee                                                AS monthly_fee,
    'month'::text                                                AS billing_period,
    o.capacity                                                   AS capacity,
    GREATEST(o.capacity - ops.seats_taken(o.id), 0)              AS seats_remaining,
    (SELECT count(*) FROM ops.registrations r
      WHERE r.program_id = o.id AND r.status = 'waitlisted')::integer AS waitlist_count,
    o.registration_open                                          AS registration_open,
    o.status                                                     AS status,
    s.name                                                       AS venue_name,
    NULL::text                                                   AS venue_city,
    nullif(btrim(s.address), '')                                 AS venue_address,
    coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'dow',   t.day_of_week,
                   'start', to_char(t.start_time, 'HH24:MI'),
                   'end',   to_char(t.end_time, 'HH24:MI'))
               ORDER BY t.day_of_week, t.start_time)
          FROM ops.schedule_templates t
         WHERE t.program_id = o.id
    ), '[]'::jsonb)                                              AS schedule,
    coalesce(l.featured, false)                                  AS featured,
    coalesce(l.sort_order, 0)                                    AS sort_order
FROM ops.programs o
JOIN ops.schools s              ON s.id = o.school_id
LEFT JOIN ops.program_catalog c ON c.id = o.catalog_id
LEFT JOIN ops.seasons se        ON se.id = o.season_id
-- CoachOS keeps one listing per session; if two ever point at one, the most
-- recently edited wins rather than the session appearing twice.
LEFT JOIN LATERAL (
    SELECT p.*
      FROM public.programs p
     WHERE p.ops_program_id = o.id
     ORDER BY p.updated_at DESC, p.id
     LIMIT 1
) l ON true
WHERE o.status IN ('active', 'upcoming')
  AND CASE WHEN l.id IS NOT NULL THEN l.published ELSE o.registration_open END;

COMMENT ON VIEW public.site_offerings IS
    'Website contract v1: published active/upcoming sessions with their marketing overlay. No PII. Column list pinned by tests/integration/website-contract.test.ts.';

REVOKE ALL ON public.site_offerings FROM PUBLIC;
GRANT SELECT ON public.site_offerings TO anon, authenticated, service_role;
