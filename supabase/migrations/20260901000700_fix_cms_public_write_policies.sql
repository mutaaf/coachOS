-- ============================================================================
-- Close public write access to the marketing CMS tables.
--
-- `programs`, `partnerships`, and `testimonials` each carried a policy named
-- for authenticated users that was in fact:
--
--     FOR ALL TO public USING (true) WITH CHECK (true)
--
-- RLS policies are permissive and OR'd together, so that one policy granted
-- INSERT, UPDATE, and DELETE to anyone holding the anon key — which ships in
-- the site's JavaScript bundle. Any visitor could rewrite or delete every
-- program listing and testimonial on risingstars.training.
--
-- The `content_*` tables already had this right: public SELECT, writes behind
-- is_admin(). This brings the other three in line. Public read is preserved
-- exactly, so nothing the site renders changes; the admin dashboard continues
-- to work because is_admin() is satisfied by any signed-in user, which is what
-- those tables already relied on.
-- ============================================================================

-- programs
DROP POLICY IF EXISTS "Enable all operations for authenticated users" ON public.programs;
DROP POLICY IF EXISTS "Allow full access to authenticated users"      ON public.programs;

CREATE POLICY "Admins can write programs"
    ON public.programs FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- partnerships (had no public SELECT policy of its own — the over-permissive
-- one was doing that job, so an explicit read policy replaces it)
DROP POLICY IF EXISTS "Enable all operations for authenticated users" ON public.partnerships;
DROP POLICY IF EXISTS "Allow full access to authenticated users"      ON public.partnerships;

CREATE POLICY "Allow public read access to partnerships"
    ON public.partnerships FOR SELECT
    USING (true);

CREATE POLICY "Admins can write partnerships"
    ON public.partnerships FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- testimonials
DROP POLICY IF EXISTS "Allow anonymous operations on testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Allow full access to authenticated users"   ON public.testimonials;

CREATE POLICY "Admins can write testimonials"
    ON public.testimonials FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
