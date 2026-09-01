"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";

export async function createStudent(formData: FormData) {
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = formData.get("phone") as string;
  const preferred_payment =
    (formData.get("preferred_payment") as "cash" | "zelle" | "venmo" | "stripe") || "cash";
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
  const supabase = createAdminSupabase();

  const first_name = formData.get("first_name") as string;
  const last_name = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = formData.get("phone") as string;
  const preferred_payment =
    (formData.get("preferred_payment") as "cash" | "zelle" | "venmo" | "stripe") || "cash";
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
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

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

  // Look up school for revalidation
  const { data: program } = await supabase
    .from("programs")
    .select("school_id")
    .eq("id", programId)
    .single();

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/schools");
  if (program) {
    revalidatePath(`/schools/${program.school_id}`);
  }
  return { data };
}

export async function deleteStudent(studentId: string) {
  const supabase = createAdminSupabase();

  // Check for active enrollments
  const { data: activeEnrollments } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("status", "active");

  if (activeEnrollments && activeEnrollments.length > 0) {
    return { error: "Cannot delete student with active enrollments. Withdraw them first." };
  }

  // Delete student_parents links
  await supabase.from("student_parents").delete().eq("student_id", studentId);

  // Delete the student
  const { error } = await supabase.from("students").delete().eq("id", studentId);

  if (error) {
    console.error("Error deleting student:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  return { success: true };
}

export async function deleteParent(parentId: string) {
  const supabase = createAdminSupabase();

  // Check for linked students
  const { data: links } = await supabase
    .from("student_parents")
    .select("student_id")
    .eq("parent_id", parentId);

  if (links && links.length > 0) {
    return { error: "Cannot delete parent linked to students. Unlink them first." };
  }

  const { error } = await supabase.from("parents").delete().eq("id", parentId);

  if (error) {
    console.error("Error deleting parent:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  return { success: true };
}

export async function withdrawEnrollment(enrollmentId: string) {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("enrollments")
    .update({ status: "withdrawn" })
    .eq("id", enrollmentId)
    .select("*, programs(school_id)")
    .single();

  if (error) {
    console.error("Error withdrawing enrollment:", error);
    return { error: error.message };
  }

  revalidatePath("/students");
  if (data) {
    revalidatePath(`/students/${data.student_id}`);
    const schoolId = (data as any).programs?.school_id;
    revalidatePath("/schools");
    if (schoolId) {
      revalidatePath(`/schools/${schoolId}`);
    }
  }
  return { data };
}
