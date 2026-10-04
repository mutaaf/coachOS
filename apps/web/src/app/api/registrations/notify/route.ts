import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { welcomeRegistration } from "@/lib/family-messages";
import { sameName } from "@/lib/roster";

/**
 * The website (risingstars.training) registers families straight into the
 * database from the parent's browser, so nothing on a server sees it happen.
 * After a registration succeeds, the site pings this to send the family's
 * "you're in" email and put their message in the Outbox.
 *
 * It takes no secret — the site runs in the parent's browser and could not
 * keep one — so it is built to be harmless: it only emails registrations made
 * in the last hour, matched on the details the parent just typed, and each
 * registration's email goes at most once (the emails log's dedupe key). The
 * daily run sends any it missed.
 *
 * It answers with the program's WhatsApp group link when — and only when —
 * the details match a place secured in the last hour: the family who just
 * signed up is exactly who the group is for, and the link stays off public
 * pages. Otherwise it answers the same as for nothing found.
 */

const ORIGINS = ["https://risingstars.training", "https://www.risingstars.training"];

function cors(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const programId = String(body?.program_id ?? "");
  const phone = String(body?.parent_phone ?? "");
  const child = String(body?.child_first_name ?? "").trim();
  const digits = phone.replace(/\D/g, "").slice(-10);

  let whatsappGroupUrl: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(programId) && digits.length === 10 && child) {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from("registrations")
      .select("id, status, parent_phone, child_first_name, programs(whatsapp_group_url)")
      .eq("program_id", programId)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString())
      .limit(200);
    for (const r of data || []) {
      // Compared here, not as a database pattern: "%" must match nothing.
      if (!sameName(r.child_first_name, child)) continue;
      if (String(r.parent_phone).replace(/\D/g, "").slice(-10) !== digits) continue;
      await welcomeRegistration(supabase, r.id);
      if (r.status !== "waitlisted") whatsappGroupUrl = (r as any).programs?.whatsapp_group_url ?? null;
    }
  }
  return NextResponse.json({ ok: true, whatsappGroupUrl }, { headers: cors(request) });
}
