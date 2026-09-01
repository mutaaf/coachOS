import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// The operational tables live in the `ops` schema; `public` in this database
// belongs to the marketing site's CMS. See supabase/migrations/00000_ops_schema.sql.
const OPS_SCHEMA = { db: { schema: "ops" } } as const;

/**
 * Next.js caches `fetch` responses by URL in its Data Cache, and supabase-js
 * goes through `fetch`. Without opting out, a page that has been viewed once
 * keeps serving that snapshot indefinitely — seat counts freeze, and a parent
 * can be shown spots in a program that is already full.
 *
 * `export const dynamic = "force-dynamic"` governs rendering, not this cache,
 * so it has to be disabled on the client itself.
 */
const noStore: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });


export function createServerSupabase() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...OPS_SCHEMA,
      global: { fetch: noStore },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore in Server Components
          }
        },
      },
    }
  );
}

export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { ...OPS_SCHEMA, global: { fetch: noStore } }
  );
}

/**
 * Service-role client against the `public` schema — the marketing site's CMS.
 *
 * Used only to link a program to its website listing; everything operational
 * goes through createAdminSupabase() and the `ops` schema.
 */
export function createAdminPublicSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: noStore } }
  );
}
