"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function createProgram(formData: FormData) {
  const supabase = createServerSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const season = formData.get("season") as string | null;
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const monthlyFee = parseFloat(formData.get("monthly_fee") as string) || 120;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;

  if (!schoolId || !name) {
    return { error: "School and program name are required." };
  }

  const { error } = await supabase.from("programs").insert({
    school_id: schoolId,
    name,
    season: season || null,
    start_date: startDate || null,
    end_date: endDate || null,
    monthly_fee: monthlyFee,
    status: status || "upcoming",
    notes: notes || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schools");
  revalidatePath(`/schools/${schoolId}`);

  return { success: true };
}

export async function updateProgram(id: string, formData: FormData) {
  const supabase = createServerSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const season = formData.get("season") as string | null;
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const monthlyFee = parseFloat(formData.get("monthly_fee") as string) || 120;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;

  if (!schoolId || !name) {
    return { error: "School and program name are required." };
  }

  const { error } = await supabase
    .from("programs")
    .update({
      school_id: schoolId,
      name,
      season: season || null,
      start_date: startDate || null,
      end_date: endDate || null,
      monthly_fee: monthlyFee,
      status: status || "upcoming",
      notes: notes || null,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schools");
  revalidatePath(`/schools/${schoolId}`);

  return { success: true };
}

export async function updateProgramStatus(
  id: string,
  status: "active" | "upcoming" | "completed" | "cancelled"
) {
  const supabase = createServerSupabase();

  // Fetch the program first to get the school_id for revalidation
  const { data: program } = await supabase
    .from("programs")
    .select("school_id")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("programs")
    .update({ status })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schools");
  if (program?.school_id) {
    revalidatePath(`/schools/${program.school_id}`);
  }

  return { success: true };
}
