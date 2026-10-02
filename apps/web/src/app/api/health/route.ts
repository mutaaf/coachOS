import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * What the deploy checks before calling a release good: this is the build it
 * just shipped, and it can reach the database. Says nothing about anyone's data.
 */
export async function GET() {
  const { error } = await createAdminSupabase().from("config").select("key").limit(1);
  const body = {
    ok: !error,
    // Baked in at build time by the deploy (NEXT_PUBLIC_ is inlined), so this
    // names the build actually serving.
    sha: process.env.NEXT_PUBLIC_APP_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    database: error ? "unreachable" : "ok",
  };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
