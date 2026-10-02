import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { recordRelease } from "@/lib/releases";

/**
 * Where the release workflow records each release (see .github/workflows/ship.yml).
 * The key is the RELEASE_SECRET environment variable, held by Vercel and by
 * GitHub's secrets; nothing else can write here.
 */
function authorised(header: string | null) {
  const secret = process.env.RELEASE_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  if (!authorised(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const result = await recordRelease(createAdminSupabase(), body);
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}
