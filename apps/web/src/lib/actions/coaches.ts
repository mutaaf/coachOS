"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";

function readCoachFields(formData: FormData) {
  const rate = parseFloat(formData.get("pay_rate") as string);

  return {
    first_name: ((formData.get("first_name") as string) || "").trim(),
    last_name: ((formData.get("last_name") as string) || "").trim(),
    phone: ((formData.get("phone") as string) || "").trim(),
    email: ((formData.get("email") as string) || "").trim() || null,
    status: (formData.get("status") as string) || "active",
    pay_rate: Number.isFinite(rate) ? rate : null,
    pay_type: (formData.get("pay_type") as string) || "per_session",
    // Most coaches arrive via Facebook Marketplace or word of mouth, and
    // knowing which is the difference between repeating what worked and
    // guessing.
    source: ((formData.get("source") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
  };
}

export async function createCoach(formData: FormData) {
  const supabase = createAdminSupabase();
  const fields = readCoachFields(formData);

  if (!fields.first_name || !fields.last_name || !fields.phone) {
    return { error: "A coach needs a first name, last name, and phone number." };
  }

  const { error } = await supabase.from("coaches").insert(fields);
  if (error) return { error: error.message };

  revalidatePath("/coaches");
  revalidatePath("/schedule");
  return { success: true };
}

export async function updateCoach(id: string, formData: FormData) {
  const supabase = createAdminSupabase();
  const fields = readCoachFields(formData);

  if (!fields.first_name || !fields.last_name || !fields.phone) {
    return { error: "A coach needs a first name, last name, and phone number." };
  }

  const { error } = await supabase.from("coaches").update(fields).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/coaches");
  revalidatePath("/schedule");
  return { success: true };
}

/**
 * Deleting a coach who has worked sessions would erase who ran them, so this
 * refuses and points at marking them inactive instead — which keeps the history
 * and takes them out of the assignment lists.
 */
export async function deleteCoach(id: string) {
  const supabase = createAdminSupabase();

  const { count } = await supabase
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("coach_id", id);

  if ((count ?? 0) > 0) {
    return {
      error: `This coach is on ${count} session${count === 1 ? "" : "s"}. Mark them inactive instead, so the record of who ran them survives.`,
    };
  }

  const { error } = await supabase.from("coaches").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/coaches");
  return { success: true };
}

/** Who is scheduled for this weekly slot from now on. */
export async function assignCoachToTemplate(templateId: string, coachId: string | null) {
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("schedule_templates")
    .update({ coach_id: coachId })
    .eq("id", templateId);

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  revalidatePath("/coaches");
  return { success: true };
}

/**
 * Who actually ran one session. Kept separate from the weekly slot because
 * substitutions are normal, and the session is what gets paid.
 */
export async function assignCoachToSession(sessionId: string, coachId: string | null) {
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("sessions")
    .update({ coach_id: coachId })
    .eq("id", sessionId);

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  revalidatePath("/coaches");
  return { success: true };
}
