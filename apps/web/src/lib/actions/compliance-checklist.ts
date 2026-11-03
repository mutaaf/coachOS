"use server";

import { revalidatePath } from "next/cache";
import { currentStaff, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The compliance checklist: mark a task done (the due date rolls forward on
 * its own) or change who owns it and when it's due. Admin and compliance
 * staff alike, as themselves; the database checks the role and writes the
 * audit log (20261007000430).
 */

export interface CompletionInput {
  doneOn?: string;
  notes?: string;
  evidenceUrl?: string;
  record?: Record<string, string>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function completeChecklistTask(taskId: string, input: CompletionInput) {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  const doneOn = input?.doneOn && DATE.test(input.doneOn) ? input.doneOn : null;
  const evidence = (input?.evidenceUrl ?? "").trim();
  if (evidence && !/^https?:\/\/\S+$/i.test(evidence)) return { error: "The evidence link must start with http:// or https://." };
  const { data, error } = await createServerSupabase().rpc("complete_compliance_task", {
    p_task_id: String(taskId ?? ""),
    p_done_on: doneOn,
    p_notes: input?.notes ?? null,
    p_evidence_url: evidence || null,
    p_record: input?.record && typeof input.record === "object" ? input.record : {},
  });
  if (error) return { error: error.message };
  revalidatePath("/compliance");
  return { success: true as const, nextDue: data as string };
}

export async function updateChecklistTask(taskId: string, owner: string, nextDue: string) {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  if (!DATE.test(String(nextDue ?? ""))) return { error: "Give it a due date." };
  const { error } = await createServerSupabase().rpc("update_compliance_task", {
    p_task_id: String(taskId ?? ""),
    p_owner: String(owner ?? ""),
    p_next_due: nextDue,
  });
  if (error) return { error: error.message };
  revalidatePath("/compliance");
  return { success: true as const };
}
