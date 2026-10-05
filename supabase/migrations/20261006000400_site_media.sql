-- ============================================================================
-- Site photos, managed in CoachOS (website contract v1.2).
--
-- The website's pictures were baked into its code (AI cartoons the owner
-- wants gone) or typed per listing. From here the owner uploads real photos to
-- a library on the Website page, writes alt text, picks a focal point, and
-- puts each one in a place on the site ("slot"). The website reads
-- public.site_media at runtime, so a change is live without a deploy.
--
--   ops.site_media             one row per photo: its files, alt text, focal
--                              point, the child-safety answers, published
--   ops.site_media_placements  where a photo shows: a slot, and for the
--                              `offering` slot which session's card
--   public.site_media          (view, anon) one row per placement of a photo
--                              that may be shown — the contract's columns only
--   storage bucket site-media  public read; written only by CoachOS's server
--                              (service role) after its admin check
--
-- Child safety: a photo marked as showing identifiable children cannot be
-- published until the owner confirms a photo release is on file for every one
-- of them. The view enforces it as well, so a row edited by hand still cannot
-- leak.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE ops.site_media (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'uploading' until the server has checked the file and made its sizes.
  status                       text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  -- Storage paths in the site-media bucket, and their public addresses.
  original_path                text,
  url                          text NOT NULL DEFAULT '',
  srcset                       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(srcset) = 'array'),
  file_paths                   text[] NOT NULL DEFAULT '{}',
  width                        integer CHECK (width IS NULL OR width > 0),
  height                       integer CHECK (height IS NULL OR height > 0),
  bytes                        integer,
  mime_type                    text,
  original_filename            text,
  alt                          text NOT NULL DEFAULT '',
  caption                      text,
  focal_x                      numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_x BETWEEN 0 AND 1),
  focal_y                      numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_y BETWEEN 0 AND 1),
  contains_identifiable_minors boolean NOT NULL DEFAULT false,
  photo_release_confirmed      boolean NOT NULL DEFAULT false,
  published                    boolean NOT NULL DEFAULT false,
  notes                        text,
  uploaded_by                  uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_media_publishable CHECK (
    NOT published OR (
      status = 'ready'
      AND url <> ''
      AND length(btrim(alt)) > 0
      AND (NOT contains_identifiable_minors OR photo_release_confirmed)
    )
  )
);

COMMENT ON TABLE ops.site_media IS
  'Website photo library (contract v1.2). Exposed only through public.site_media.';
COMMENT ON COLUMN ops.site_media.photo_release_confirmed IS
  'The owner confirmed a signed photo release is on file for every identifiable child in the photo.';

CREATE TABLE ops.site_media_placements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id    uuid NOT NULL REFERENCES ops.site_media (id) ON DELETE CASCADE,
  slot        text NOT NULL CHECK (
                slot IN ('hero', 'programs_section', 'levels_section', 'about', 'partnerships_section',
                         'contact_section', 'og_default', 'offering')
                OR slot ~ '^sport:[a-z0-9]+([ _-][a-z0-9]+)*$'
              ),
  offering_id uuid REFERENCES ops.programs (id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((slot = 'offering') = (offering_id IS NOT NULL))
);

-- A photo is in a place once.
CREATE UNIQUE INDEX site_media_placements_once
  ON ops.site_media_placements (media_id, slot, offering_id) NULLS NOT DISTINCT;
CREATE INDEX site_media_placements_slot ON ops.site_media_placements (slot, sort_order);
CREATE INDEX site_media_placements_offering ON ops.site_media_placements (offering_id) WHERE offering_id IS NOT NULL;

CREATE TRIGGER site_media_updated_at BEFORE UPDATE ON ops.site_media
  FOR EACH ROW EXECUTE FUNCTION ops.update_updated_at_column();
CREATE TRIGGER site_media_placements_updated_at BEFORE UPDATE ON ops.site_media_placements
  FOR EACH ROW EXECUTE FUNCTION ops.update_updated_at_column();

ALTER TABLE ops.site_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.site_media_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage site media" ON ops.site_media FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
CREATE POLICY "Admins manage site media placements" ON ops.site_media_placements FOR ALL TO authenticated
  USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()));
GRANT ALL ON ops.site_media, ops.site_media_placements TO authenticated, service_role;
REVOKE ALL ON ops.site_media, ops.site_media_placements FROM anon;

-- ----------------------------------------------------------------------------
-- The view the website reads. Owner rights (so anon needs nothing in ops),
-- an explicit column list, and the publish rule repeated here.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.site_media AS
SELECT
    p.id                                   AS id,
    p.slot                                 AS slot,
    p.offering_id                          AS offering_id,
    p.sort_order                           AS sort_order,
    btrim(m.alt)                           AS alt,
    nullif(btrim(m.caption), '')           AS caption,
    m.focal_x::numeric                     AS focal_x,
    m.focal_y::numeric                     AS focal_y,
    m.width                                AS width,
    m.height                               AS height,
    m.url                                  AS url,
    m.srcset                               AS srcset,
    GREATEST(m.updated_at, p.updated_at)   AS updated_at
FROM ops.site_media_placements p
JOIN ops.site_media m ON m.id = p.media_id
WHERE m.published
  AND m.status = 'ready'
  AND m.url <> ''
  AND length(btrim(m.alt)) > 0
  AND (NOT m.contains_identifiable_minors OR m.photo_release_confirmed);

COMMENT ON VIEW public.site_media IS
    'Website contract v1.2: published photo placements. No uploader, release or notes. Column list pinned by tests/integration/website-contract.test.ts.';

REVOKE ALL ON public.site_media FROM PUBLIC;
GRANT SELECT ON public.site_media TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Storage: public read, nobody but the service role writes.
--
-- A public bucket serves its files to anyone by URL without any policy. No
-- policy here lets anon or a signed-in user write, list or delete — and a
-- restrictive one makes sure no broader policy (the website's old admin had
-- some for its own bucket) ever opens this bucket to them. CoachOS's server
-- writes with the service role, after checking the caller is an admin.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-media', 'site-media', true, 15 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
ON CONFLICT (id) DO UPDATE
   SET public = true,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "site-media is written only by CoachOS" ON storage.objects;
CREATE POLICY "site-media is written only by CoachOS" ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'site-media')
  WITH CHECK (bucket_id <> 'site-media');
