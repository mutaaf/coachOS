import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { emailRegistration } from "@/lib/parent-emails";
import { sameName } from "@/lib/roster";

/**
 * The website (risingstars.training) registers families straight into the
 * database from the parent's browser, so nothing on a server sees it happen.
 * After a registration succeeds, the site pings this to send the family's
 * "you're in" email, and gets back the program's WhatsApp group link to show.
 *
 * Two ways in:
 *
 *   { registration_ids, token }  — from public.submit_registration_v2, whose
 *     notify_token is an HMAC over exactly those ids with a one-hour expiry.
 *     The database checks it (ops.verify_notify_token: the secret never leaves
 *     the database), so only the browser that made the registrations can ask
 *     about them. Anything else is a 403.
 *
 *   { program_id, parent_phone, child_first_name }  — the old way, for the
 *     website until it moves to v2. It takes no secret, so it is built to be
 *     harmless: it only emails registrations made in the last hour, matched on
 *     the details the parent just typed. Switched off by setting
 *     NOTIFY_LEGACY_ENABLED=false once the website ships v2.
 *
 * Either way each registration's email goes at most once (the emails log's
 * dedupe key), the daily run sends any it missed, and the group link comes
 * back only when one of the registrations has a place — never for the
 * waitlist, and never on a public page.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Off only when explicitly set to false: the live website still sends the old body. */
function legacyNotifyEnabled() {
  return !/^(false|0|off|no)$/i.test(process.env.NOTIFY_LEGACY_ENABLED ?? "");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const headers = cors(request);

  if (body && (Array.isArray(body.registration_ids) || "token" in body)) {
    const ids: unknown[] = Array.isArray(body.registration_ids) ? body.registration_ids : [];
    const token = typeof body.token === "string" ? body.token : "";
    if (!ids.length || ids.length > 20 || !ids.every((id) => typeof id === "string" && UUID.test(id)) || !token || token.length > 200) {
      return NextResponse.json({ error: "registration_ids and token are required" }, { status: 400, headers });
    }
    const supabase = createAdminSupabase();
    const { data: valid, error } = await supabase.rpc("verify_notify_token", {
      p_registration_ids: ids,
      p_token: token,
    });
    if (error) return NextResponse.json({ error: "Could not check the token" }, { status: 500, headers });
    if (valid !== true) return NextResponse.json({ error: "Invalid or expired token" }, { status: 403, headers });

    const { data } = await supabase
      .from("registrations")
      .select("id, status, programs(whatsapp_group_url)")
      .in("id", ids as string[]);
    let whatsappGroupUrl: string | null = null;
    for (const r of data || []) {
      await emailRegistration(supabase, r.id);
      if (r.status === "confirmed") whatsappGroupUrl = (r as any).programs?.whatsapp_group_url ?? whatsappGroupUrl;
    }
    return NextResponse.json({ ok: true, whatsappGroupUrl }, { headers });
  }

  if (!legacyNotifyEnabled()) {
    return NextResponse.json({ error: "Send registration_ids and token" }, { status: 410, headers });
  }

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
      await emailRegistration(supabase, r.id);
      if (r.status !== "waitlisted") whatsappGroupUrl = (r as any).programs?.whatsapp_group_url ?? null;
    }
  }
  return NextResponse.json({ ok: true, whatsappGroupUrl }, { headers });
}
