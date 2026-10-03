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
-- app_metadata). Grant it with:
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
SET search_path = ''
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

REVOKE ALL ON FUNCTION ops.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.is_admin() TO authenticated, service_role;

-- Every policy on ops that lets "authenticated" in now also asks for the role.
-- ALTER POLICY changes the condition in place, so nothing is dropped.
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
      EXECUTE format('ALTER POLICY %I ON ops.%I WITH CHECK (ops.is_admin())', p.policyname, p.tablename);
    ELSIF p.cmd IN ('SELECT', 'DELETE') THEN
      EXECUTE format('ALTER POLICY %I ON ops.%I USING (ops.is_admin())', p.policyname, p.tablename);
    ELSE
      EXECUTE format('ALTER POLICY %I ON ops.%I USING (ops.is_admin()) WITH CHECK (ops.is_admin())', p.policyname, p.tablename);
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
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
