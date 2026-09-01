import { createBrowserClient } from "@supabase/ssr";

// The operational tables live in the `ops` schema; `public` in this database
// belongs to the marketing site's CMS. See supabase/migrations/00000_ops_schema.sql.
const OPS_SCHEMA = { db: { schema: "ops" } } as const;

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    OPS_SCHEMA
  );
}
