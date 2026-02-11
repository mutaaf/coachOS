"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function createStudent(formData: FormData) {
  const supabase = createServerSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const grade = (formData.get("grade") as string) || null;
  const date_of_birth = (formData.get("date_of_birth") as string) || null;
  const medical_notes = (formData.get("medical_notes") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!first_name || !last_name) {
    return { error: "First name and last name are required." };
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      first_name,
      last_name,
      grade,
      date_of_birth,
      medical_notes,
      notes,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  return { data };
}

export async function updateStudent(id: string, formData: FormData) {
  const supabase = createServerSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const grade = (formData.get("grade") as string) || null;
  const date_of_birth = (formData.get("date_of_birth") as string) || null;
  const medical_notes = (formData.get("medical_notes") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!first_name || !last_name) {
    return { error: "First name and last name are required." };
  }

  const { data, error } = await supabase
    .from("students")
    .update({
      first_name,
      last_name,
      grade,
      date_of_birth,
      medical_notes,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${id}`);
  return { data };
}

export async function createParent(formData: FormData) {
  const supabase = createServerSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = formData.get("phone") as string;
  const preferred_payment =
    (formData.get("preferred_payment") as "cash" | "zelle" | "venmo") || "cash";
  const venmo_handle = (formData.get("venmo_handle") as string) || null;
  const zelle_identifier = (formData.get("zelle_identifier") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!first_name || !last_name || !phone) {
    return { error: "First name, last name, and phone are required." };
  }

  const { data, error } = await supabase
    .from("parents")
    .insert({
      first_name,
      last_name,
      email,
      phone,
      preferred_payment,
      venmo_handle,
      zelle_identifier,
      notes,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating parent:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  return { data };
}

export async function updateParent(id: string, formData: FormData) {
  const supabase = createServerSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = formData.get("phone") as string;
  const preferred_payment =
    (formData.get("preferred_payment") as "cash" | "zelle" | "venmo") || "cash";
  const venmo_handle = (formData.get("venmo_handle") as string) || null;
  const zelle_identifier = (formData.get("zelle_identifier") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!first_name || !last_name || !phone) {
    return { error: "First name, last name, and phone are required." };
  }

  const { data, error } = await supabase
    .from("parents")
    .update({
      first_name,
      last_name,
      email,
      phone,
      preferred_payment,
      venmo_handle,
      zelle_identifier,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating parent:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students`);
  return { data };
}

export async function linkParentToStudent(
  studentId: string,
  parentId: string,
  relationship: string
) {
  const supabase = createServerSupabase();

  const { error } = await supabase.from("student_parents").insert({
    student_id: studentId,
    parent_id: parentId,
    relationship,
  });

  if (error) {
    console.error("Error linking parent to student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

export async function unlinkParentFromStudent(
  studentId: string,
  parentId: string
) {
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("student_parents")
    .delete()
    .eq("student_id", studentId)
    .eq("parent_id", parentId);

  if (error) {
    console.error("Error unlinking parent from student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

export async function enrollStudent(studentId: string, programId: string) {
  const supabase = createServerSupabase();

  // Check for existing active enrollment
  const { data: existing } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("program_id", programId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { error: "Student is already enrolled in this program." };
  }

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      student_id: studentId,
      program_id: programId,
      status: "active",
    })
    .select()
    .single();

  if (error) {
    console.error("Error enrolling student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { data };
}

export async function withdrawEnrollment(enrollmentId: string) {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("enrollments")
    .update({ status: "withdrawn" })
    .eq("id", enrollmentId)
    .select()
    .single();

  if (error) {
    console.error("Error withdrawing enrollment:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  if (data) {
    revalidatePath(`/students/${data.student_id}`);
  }
  return { data };
}
