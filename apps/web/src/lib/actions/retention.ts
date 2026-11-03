"use server";

import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { runRetention } from "@/lib/retention";

/** "What would the clean-up remove tonight?" Counts only; nothing is erased. */
export async function previewRetention() {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  try {
    return { success: true as const, result: await runRetention(createAdminSupabase(), { dryRun: true }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't count." };
  }
}
