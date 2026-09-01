-- ============================================================================
-- Dedicated `ops` schema for the operational (CoachOS) tables.
--
-- The Rising Stars database also backs the public marketing site, whose CMS
-- tables live in `public` and include its own `programs` table. Namespacing
-- the operational tables keeps the two from colliding and keeps the live site
-- untouched.
--
-- `anon` is deliberately NOT granted usage: the operational tables hold
-- student and parent PII. Public traffic (the registration page) reaches them
-- only through server actions using the service role.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ops;

GRANT USAGE ON SCHEMA ops TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA ops
    GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops
    GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops
    GRANT ALL ON FUNCTIONS TO authenticated, service_role;
