-- ============================================================================
-- Signed in is not the same as allowed in.
--
-- Every policy on the operational tables said "authenticated": anyone with an
-- account in this Supabase project. Accounts are shared with the marketing
-- site, and public sign-up was on, so anyone could have made one and then read
-- or changed every child's and parent's details through the REST API — no
-- CoachOS involved. The website's own is_admin() said the same.
--
-- Now both require the admin role, held in app_metadata, which only the
-- service role can set (a user can edit their user_metadata, never their
-- app_metadata). The role is read live from auth.users, not from the
-- caller's token: a token says what was true when it was issued, so taking
-- someone's access away would otherwise not bite until it expired (an hour).
-- Grant it with:
--
--   supabase.auth.admin.updateUserById(id, { app_metadata: { role: "admin" } })
--
-- Sign-up is also switched off in the project's auth settings.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE OR REPLACE FUNCTION ops.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = auth.uid()) = 'admin',
    false
  )
$$;

REVOKE ALL ON FUNCTION ops.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.is_admin() TO authenticated, service_role;

-- Every policy on ops that lets "authenticated" in now also asks for the role.
-- ALTER POLICY changes the condition in place, so nothing is dropped. The
-- (SELECT …) wrapper has Postgres evaluate it once per query, not per row.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'ops' AND 'authenticated' = ANY (roles)
  LOOP
    IF p.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON ops.%I WITH CHECK ((SELECT ops.is_admin()))', p.policyname, p.tablename);
    ELSIF p.cmd IN ('SELECT', 'DELETE') THEN
      EXECUTE format('ALTER POLICY %I ON ops.%I USING ((SELECT ops.is_admin()))', p.policyname, p.tablename);
    ELSE
      EXECUTE format('ALTER POLICY %I ON ops.%I USING ((SELECT ops.is_admin())) WITH CHECK ((SELECT ops.is_admin()))', p.policyname, p.tablename);
    END IF;
  END LOOP;
END;
$$;

-- The marketing site's admin check, which guards its programs, hero,
-- testimonials and the rest. Same rule.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = auth.uid()) = 'admin',
    false
  )
$$;
