import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { businessDaysAgo } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * The nightly check's view of the business (.github/workflows/health.yml):
 * is everything that should happen by itself still happening? Counts and
 * times only — never a name — because the result lands in a public issue.
 *
 * Bearer HEALTH_SECRET.
 */
function authorised(header: string | null) {
  const secret = process.env.HEALTH_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const hoursSince = (iso: string | null | undefined) =>
  iso && !Number.isNaN(Date.parse(iso)) ? (Date.now() - Date.parse(iso)) / 3_600_000 : null;

export async function GET(request: NextRequest) {
  if (!authorised(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createAdminSupabase();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [config, failedAutopay, failedEmails, waitingZelle, stuckProcessing, openReports] = await Promise.all([
    db.from("config").select("key, value").in("key", ["cron_last_run", "zelle_script_last_seen", "stripe_mode"]),
    count(db.from("invoices").select("id", { count: "exact", head: true }).eq("autopay_status", "failed").gte("autopay_attempted_at", dayAgo)),
    count(db.from("emails").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", dayAgo)),
    count(db.from("zelle_receipts").select("id", { count: "exact", head: true }).in("status", ["unmatched", "unreadable"]).lt("received_at", businessDaysAgo(2))),
    count(db.from("invoices").select("id", { count: "exact", head: true }).eq("status", "processing").lt("autopay_attempted_at", businessDaysAgo(10))),
    count(db.from("problem_reports").select("id", { count: "exact", head: true }).in("status", ["new", "sent"])),
  ]);
  const c = Object.fromEntries((config.data || []).map((r) => [r.key, r.value as string]));

  const cronHours = hoursSince(c.cron_last_run);
  const zelleHours = hoursSince(c.zelle_script_last_seen);
  const checks = [
    { name: "Daily run (invoices, autopay, reminders)", ok: cronHours !== null && cronHours < 26, detail: cronHours === null ? "never recorded" : `${cronHours.toFixed(1)}h ago` },
    { name: "Gmail Zelle script", ok: zelleHours === null || zelleHours < 1, detail: zelleHours === null ? "not set up" : `checked in ${(zelleHours * 60).toFixed(0)} min ago` },
    { name: "Autopay failures (24h)", ok: failedAutopay === 0, detail: String(failedAutopay) },
    { name: "Emails that failed to send (24h)", ok: failedEmails === 0, detail: String(failedEmails) },
    { name: "Zelle payments waiting over 2 days", ok: waitingZelle === 0, detail: String(waitingZelle) },
    { name: "Bank debits processing over 10 days", ok: stuckProcessing === 0, detail: String(stuckProcessing) },
  ];
  return NextResponse.json(
    { ok: checks.every((x) => x.ok), stripeMode: c.stripe_mode ?? null, openReports, checks },
    { headers: { "cache-control": "no-store" } }
  );
}
