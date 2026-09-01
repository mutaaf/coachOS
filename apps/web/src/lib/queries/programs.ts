import { createAdminSupabase } from "@/lib/supabase/server";

export async function getPrograms() {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("*, school:schools(*)")
    .order("school_id")
    .order("name");

  if (error) throw error;
  return data;
}

export async function getProgram(id: string) {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("*, school:schools(*)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function getProgramsBySchool(schoolId: string) {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("*, school:schools(*)")
    .eq("school_id", schoolId)
    .order("name");

  if (error) throw error;
  return data;
}

export async function getProgramEnrollments(programId: string) {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("enrollments")
    .select(
      "*, student:students(*), student_parents:students(parents:student_parents(parent:parents(*)))"
    )
    .eq("program_id", programId)
    .order("enrolled_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getActivePrograms() {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("*, school:schools(*)")
    .eq("status", "active")
    .order("name");

  if (error) throw error;
  return data;
}

export type EnrollableProgram = {
  id: string;
  name: string;
  status: string;
  school_id: string;
  school: { name: string } | null;
};

export async function getEnrollablePrograms(): Promise<EnrollableProgram[]> {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("id, name, status, school_id, school:schools(name)")
    .in("status", ["active", "upcoming"])
    .order("school_id")
    .order("name");

  if (error) throw error;
  return data as unknown as EnrollableProgram[];
}
