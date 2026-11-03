import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { retentionDryRun, runRetention } from "@/lib/retention";

/**
 * Nightly: remove personal data that is past its keeping period (lib/retention.ts).
 *
 * Only counts (dry run) until RETENTION_ENABLED=true is set; `?dry_run=1`
 * forces a count at any time. Guarded by CRON_SECRET like every cron.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = retentionDryRun(process.env, request.nextUrl.searchParams.get("dry_run"));
  try {
    const result = await runRetention(createAdminSupabase(), { dryRun });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Retention failed" }, { status: 500 });
  }
}
