"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminSupabase, createAdminPublicSupabase } from "@/lib/supabase/server";
import { businessInstant } from "@/lib/dates";

/** Time after the practice ends to finish the register, e.g. from the car. */
const HOURS_AFTER_PRACTICE = 6;
/** The least a new link is good for, so one made for a past practice still works. */
const MINIMUM_HOURS = 12;

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
 * It lasts until a few hours after the practice ends. It used to last 12 hours
 * from being made, so a link sent at 7:29pm for a 9am practice ran out at
 * 7:29am, before the coach got to the field.
 *
 * The passcode is returned exactly once, here, because it is stored hashed and
 * cannot be read back afterwards. If it is lost, issue a new link.
 */
export async function createAttendanceLink(sessionId: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, date, end_time, status, coach_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return { error: sessionError.message };
  if (!session) return { error: "That practice no longer exists." };
  if (session.status === "cancelled") {
    return { error: "That practice was cancelled, so there is no register to take." };
  }
  if (session.status !== "scheduled") {
    return { error: "That practice is finished, so its register is closed." };
  }

  const token = generateToken();
  const passcode = generatePasscode();
  const afterPractice =
    businessInstant(session.date, session.end_time).getTime() + HOURS_AFTER_PRACTICE * 3_600_000;
  const expiresAt = new Date(
    Math.max(afterPractice, Date.now() + MINIMUM_HOURS * 3_600_000)
  ).toISOString();

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
    // Who it is for: the register shows medical notes only to the practice's
    // assigned coach (20261006000160_medical_access.sql).
    coach_id: session.coach_id ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  return { success: true, token, passcode, expiresAt };
}

export async function revokeAttendanceLink(sessionId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
