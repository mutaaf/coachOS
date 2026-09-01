"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Registration } from "@/types/database";

/**
 * Public registration submission.
 *
 * Runs with the service role because the registration page is anonymous — `anon`
 * has no access to the `ops` schema at all, which is what keeps student and
 * parent details off the public API. The capacity check and the seat itself are
 * claimed inside `ops.submit_registration`, which locks the program row so two
 * parents submitting for the last seat cannot both be confirmed.
 */
export async function submitRegistration(formData: FormData) {
  const supabase = createAdminSupabase();

  const programId = formData.get("program_id") as string;
  const childFirstName = (formData.get("child_first_name") as string)?.trim();
  const childLastName = (formData.get("child_last_name") as string)?.trim();
  const parentFirstName = (formData.get("parent_first_name") as string)?.trim();
  const parentLastName = (formData.get("parent_last_name") as string)?.trim();
  const parentPhone = (formData.get("parent_phone") as string)?.trim();
  const parentEmail = (formData.get("parent_email") as string)?.trim() || null;
  const childGrade = (formData.get("child_grade") as string)?.trim() || null;
  const childDob = (formData.get("child_date_of_birth") as string) || null;
  const medicalNotes = (formData.get("medical_notes") as string)?.trim() || null;
  const howHeard = (formData.get("how_heard") as string)?.trim() || null;

  if (
    !programId ||
    !childFirstName ||
    !childLastName ||
    !parentFirstName ||
    !parentLastName ||
    !parentPhone
  ) {
    return { error: "Please fill in your name, your child's name, and a phone number." };
  }

  // Same child, same program, twice — usually a double submit rather than twins.
  const { data: existing } = await supabase
    .from("registrations")
    .select("id, status")
    .eq("program_id", programId)
    .eq("parent_phone", parentPhone)
    .ilike("child_first_name", childFirstName)
    .ilike("child_last_name", childLastName)
    .not("status", "in", "(cancelled,declined)")
    .maybeSingle();

  if (existing) {
    return {
      error:
        "We already have a registration for this child in this program. Message us if you think that's wrong.",
    };
  }

  const { data, error } = await supabase.rpc("submit_registration", {
    p_program_id: programId,
    p_child_first_name: childFirstName,
    p_child_last_name: childLastName,
    p_parent_first_name: parentFirstName,
    p_parent_last_name: parentLastName,
    p_parent_phone: parentPhone,
    p_parent_email: parentEmail,
    p_child_grade: childGrade,
    p_child_date_of_birth: childDob,
    p_medical_notes: medicalNotes,
    p_how_heard: howHeard,
  });

  if (error) {
    return { error: error.message };
  }

  const registration = data as Registration;

  revalidatePath("/registrations");

  return {
    success: true,
    status: registration.status,
    waitlistPosition: registration.waitlist_position,
    amount: registration.amount,
  };
}

/**
 * Turn a confirmed registration into real records: a parent, a student, the link
 * between them, and an enrollment. Idempotent on re-run — an existing parent is
 * matched by phone rather than duplicated.
 */
export async function convertRegistration(registrationId: string) {
  const supabase = createAdminSupabase();

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("*")
    .eq("id", registrationId)
    .single();

  if (regError || !reg) {
    return { error: regError?.message ?? "Registration not found." };
  }

  if (reg.enrollment_id) {
    return { error: "This registration has already been converted." };
  }

  if (reg.status !== "confirmed") {
    return { error: "Only confirmed registrations can be converted." };
  }

  // Parent — reuse an existing record with the same phone number.
  let parentId = reg.parent_id as string | null;
  if (!parentId) {
    const { data: existingParent } = await supabase
      .from("parents")
      .select("id")
      .eq("phone", reg.parent_phone)
      .maybeSingle();

    if (existingParent) {
      parentId = existingParent.id;
    } else {
      const { data: newParent, error: parentError } = await supabase
        .from("parents")
        .insert({
          first_name: reg.parent_first_name,
          last_name: reg.parent_last_name,
          phone: reg.parent_phone,
          email: reg.parent_email,
        })
        .select("id")
        .single();

      if (parentError) return { error: parentError.message };
      parentId = newParent.id;
    }
  }

  // Student
  let studentId = reg.student_id as string | null;
  if (!studentId) {
    const { data: newStudent, error: studentError } = await supabase
      .from("students")
      .insert({
        first_name: reg.child_first_name,
        last_name: reg.child_last_name,
        grade: reg.child_grade,
        date_of_birth: reg.child_date_of_birth,
        medical_notes: reg.medical_notes,
      })
      .select("id")
      .single();

    if (studentError) return { error: studentError.message };
    studentId = newStudent.id;
  }

  await supabase
    .from("student_parents")
    .upsert(
      { student_id: studentId, parent_id: parentId, relationship: "parent" },
      { onConflict: "student_id,parent_id" }
    );

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("enrollments")
    .upsert(
      { student_id: studentId, program_id: reg.program_id, status: "active" },
      { onConflict: "student_id,program_id" }
    )
    .select("id")
    .single();

  if (enrollmentError) return { error: enrollmentError.message };

  const { error: updateError } = await supabase
    .from("registrations")
    .update({
      student_id: studentId,
      parent_id: parentId,
      enrollment_id: enrollment.id,
    })
    .eq("id", registrationId);

  if (updateError) return { error: updateError.message };

  revalidatePath("/registrations");
  revalidatePath("/students");

  return { success: true };
}

/**
 * Promote the next person off the waitlist, if a seat has actually opened.
 * Re-checks capacity rather than trusting the caller's view of it.
 */
export async function promoteFromWaitlist(registrationId: string) {
  const supabase = createAdminSupabase();

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("id, program_id, status")
    .eq("id", registrationId)
    .single();

  if (regError || !reg) return { error: regError?.message ?? "Registration not found." };
  if (reg.status !== "waitlisted") return { error: "That registration is not on the waitlist." };

  const { data: availability, error: availError } = await supabase
    .from("program_availability")
    .select("seats_remaining")
    .eq("program_id", reg.program_id)
    .single();

  if (availError) return { error: availError.message };
  if (!availability || availability.seats_remaining < 1) {
    return { error: "That program is still full. Free a seat first." };
  }

  const { error } = await supabase
    .from("registrations")
    .update({ status: "confirmed", waitlist_position: null })
    .eq("id", registrationId);

  if (error) return { error: error.message };

  revalidatePath("/registrations");
  return { success: true };
}

export async function setRegistrationStatus(
  registrationId: string,
  status: "pending" | "confirmed" | "waitlisted" | "cancelled" | "declined"
) {
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("registrations")
    .update({ status, ...(status === "waitlisted" ? {} : { waitlist_position: null }) })
    .eq("id", registrationId);

  if (error) return { error: error.message };

  revalidatePath("/registrations");
  return { success: true };
}

export async function setRegistrationPaymentStatus(
  registrationId: string,
  paymentStatus: "unpaid" | "paid" | "refunded" | "waived"
) {
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("registrations")
    .update({ payment_status: paymentStatus })
    .eq("id", registrationId);

  if (error) return { error: error.message };

  revalidatePath("/registrations");
  return { success: true };
}
