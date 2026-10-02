"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { currentUser, NOT_SIGNED_IN } from "@/lib/auth-guard";
import cases from "@/lib/help/acceptance-cases.json";

const IDS = new Set((cases as { id: string }[]).map((c) => c.id));

/**
 * Record a test result from Help → Test plan. Signed-in only, and only for
 * case ids that exist, so the table can't be filled with anything else.
 */
export async function saveTestResult(
  caseId: string,
  patch: { status?: "pass" | "fail" | "blocked" | "na" | null; ticks?: number[]; notes?: string }
) {
  const user = await currentUser();
  if (!user) return NOT_SIGNED_IN;
  if (!IDS.has(caseId)) return { error: "Unknown test." };

  const row: Record<string, unknown> = {
    case_id: caseId,
    updated_by: user.email,
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.ticks !== undefined) row.ticks = patch.ticks.filter((n) => Number.isInteger(n) && n >= 0 && n < 50);
  if (patch.notes !== undefined) row.notes = String(patch.notes).slice(0, 5000);

  const { error } = await createAdminSupabase().from("acceptance_results").upsert(row, { onConflict: "case_id" });
  if (error) return { error: error.message };
  revalidatePath("/help");
  return { success: true };
}
