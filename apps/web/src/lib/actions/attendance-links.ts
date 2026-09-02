"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminSupabase, createAdminPublicSupabase } from "@/lib/supabase/server";

/**
 * A passcode a coach can read off WhatsApp and type on a phone.
 *
 * Six digits is only defensible because the database locks the link after five
 * wrong guesses; without that this would be far too short.
 */
function generatePasscode() {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** Goes in the URL. Long enough that guessing it is not an avenue. */
function generateToken() {
  return randomBytes(18).toString("base64url");
}

/**
 * Create a link for one session.
 *
 * The passcode is returned exactly once, here, because it is stored hashed and
 * cannot be read back afterwards. If it is lost, issue a new link.
 */
export async function createAttendanceLink(sessionId: string, hoursValid = 12) {
  const supabase = createAdminSupabase();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, date, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return { error: sessionError.message };
  if (!session) return { error: "That session no longer exists." };
  if (session.status === "cancelled") {
    return { error: "That session was cancelled, so there is no register to take." };
  }

  const token = generateToken();
  const passcode = generatePasscode();
  const expiresAt = new Date(Date.now() + hoursValid * 3_600_000).toISOString();

  // Hash in the database so the plain passcode never lands in a column.
  const { data: hashed, error: hashError } = await createAdminPublicSupabase().rpc(
    "hash_passcode",
    { p_passcode: passcode }
  );
  if (hashError) return { error: hashError.message };

  // Any earlier link for this session stops working, so only one is live.
  await supabase
    .from("attendance_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("revoked_at", null);

  const { error } = await supabase.from("attendance_links").insert({
    session_id: sessionId,
    token,
    passcode_hash: hashed,
    expires_at: expiresAt,
  });

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  return { success: true, token, passcode, expiresAt };
}

export async function revokeAttendanceLink(sessionId: string) {
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("attendance_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("revoked_at", null);

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  return { success: true };
}
