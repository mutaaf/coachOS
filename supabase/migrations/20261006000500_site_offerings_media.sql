-- ============================================================================
-- site_offerings.image_url follows the photo library (website contract v1.2).
--
-- A card's picture is now, in order:
--   1. a photo placed on that session's card (site_media slot `offering`);
--   2. the listing's own picture (public.programs.image), then the program's
--      (ops.program_catalog.image) — what it was before;
--   3. the sport's default photo (site_media slot `sport:<sport>`);
--   4. null — the website shows its own fallback.
-- Photos come through public.site_media, so only published photos with their
-- child-safety answers in order can appear. The URL is the largest WebP size
-- made on upload (at most 1600 wide), or the original when there are none.
--
-- Same columns, same order, same types: nothing else about the view changes.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE OR REPLACE VIEW public.site_offerings AS
SELECT
    o.id                                                         AS offering_id,
    l.id                                                         AS cms_program_id,
    coalesce(nullif(btrim(l.slug), ''), o.public_slug)           AS public_slug,
    coalesce(nullif(btrim(l.title), ''), o.name)                 AS title,
    coalesce(nullif(btrim(l.description), ''),
             nullif(btrim(o.public_description), ''),
             nullif(btrim(c.description), ''))                   AS description,
    coalesce(
        -- 1. a photo placed on this session's card
        (SELECT coalesce((SELECT e ->> 'url' FROM jsonb_array_elements(m.srcset) e
                           ORDER BY (e ->> 'w')::int DESC LIMIT 1), m.url)
           FROM public.site_media m
          WHERE m.slot = 'offering' AND m.offering_id = o.id
          ORDER BY m.sort_order, m.updated_at DESC
          LIMIT 1),
        -- 2. the listing's own picture, then the program's (as before)
        nullif(btrim(l.image), ''),
        nullif(btrim(c.image), ''),
        -- 3. the sport's default photo
        (SELECT coalesce((SELECT e ->> 'url' FROM jsonb_array_elements(m.srcset) e
                           ORDER BY (e ->> 'w')::int DESC LIMIT 1), m.url)
           FROM public.site_media m
          WHERE m.slot = 'sport:' || lower(btrim(c.sport))
          ORDER BY m.sort_order, m.updated_at DESC
          LIMIT 1)
    )                                                            AS image_url,
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
    'Website contract v1.2: published active/upcoming sessions with their marketing overlay. No PII. Column list pinned by tests/integration/website-contract.test.ts.';

REVOKE ALL ON public.site_offerings FROM PUBLIC;
GRANT SELECT ON public.site_offerings TO anon, authenticated, service_role;
