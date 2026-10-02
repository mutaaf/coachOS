import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { ingestZelleEmail, type IngestResult } from "@/lib/zelle";

/**
 * Where the Gmail script reports Zelle emails.
 *
 * It posts `{ messages: [{ id, subject, text, receivedAt }] }` every fifteen
 * minutes, including emails it has sent before; each one is recorded at most
 * once. The key is the `zelle_inbound_secret` setting — anyone holding it can
 * put payments in front of the owner, so it is compared in constant time and
 * changing it in Settings cuts off the old script.
 */

const MAX_MESSAGES = 100;

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabase();

  const { data: secret } = await supabase
    .from("config")
    .select("value")
    .eq("key", "zelle_inbound_secret")
    .maybeSingle();

  if (!authorised(request.headers.get("authorization"), secret?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const messages: any[] = Array.isArray(payload?.messages) ? payload.messages : [payload];
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `At most ${MAX_MESSAGES} messages per request` }, { status: 413 });
  }

  const counts: Record<IngestResult["outcome"], number> = {
    matched: 0,
    unmatched: 0,
    unreadable: 0,
    duplicate: 0,
    skipped: 0,
  };

  // One at a time: two emails from the same family must not both be matched
  // against the same open invoice.
  for (const m of messages) {
    if (typeof m?.id !== "string" || !m.id) continue;
    const result = await ingestZelleEmail(supabase, {
      messageId: m.id,
      subject: String(m.subject ?? ""),
      text: String(m.text ?? ""),
      receivedAt:
        typeof m.receivedAt === "string" && !Number.isNaN(Date.parse(m.receivedAt))
          ? m.receivedAt
          : undefined,
    });
    counts[result.outcome]++;
  }

  return NextResponse.json({ received: messages.length, ...counts });
}
