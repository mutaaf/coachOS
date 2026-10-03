"use server";

import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Registration } from "@/types/database";
import { Directory, mergeIntoChild, phoneKey, sameName, type ChildOnFile } from "@/lib/identity";
import { normalizePhone, NOT_A_PHONE } from "@/lib/roster";
import { emailRegistration, emailWelcome } from "@/lib/parent-emails";

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
  const typedPhone = (formData.get("parent_phone") as string)?.trim();
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
    !typedPhone
  ) {
    return { error: "Please fill in your name, your child's name, and a phone number." };
  }
  // Saved as one number, so the Boss's WhatsApp link reaches them.
  const parentPhone = normalizePhone(typedPhone);
  if (!parentPhone) return { error: NOT_A_PHONE };

  // Same child, same program, twice — usually a double submit rather than twins.
  // Compared on the phone's digits, not as typed: "(214) 555-0150" and
  // "2145550150" are one parent, and letting the second through would hold a
  // second seat for the same child. Older rows may still be as typed.
  const { data: sameProgram } = await supabase
    .from("registrations")
    .select("id, status, parent_phone, child_first_name, child_last_name")
    .eq("program_id", programId)
    .not("status", "in", "(cancelled,declined)");
  const existing = (sameProgram || []).find(
    (r) =>
      phoneKey(r.parent_phone) === phoneKey(parentPhone) &&
      sameName(r.child_first_name, childFirstName) &&
      sameName(r.child_last_name, childLastName)
  );

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

  // The row the database function just made — it returns the outcome, not the id.
  const { data: made } = await supabase
    .from("registrations")
    .select("id, status")
    .eq("program_id", programId)
    .eq("parent_phone", parentPhone)
    // Escaped: a name with % or _ is matched literally.
    .ilike("child_first_name", childFirstName.replace(/[\\%_]/g, (c) => `\\${c}`))
    .not("status", "in", "(cancelled,declined)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Their "you're in" email. Never in the way: it logs a failure, never throws.
  if (made) await emailRegistration(supabase, made.id);

  // The group chat is for families with a place, and only when there is one.
  const { data: program } = await supabase
    .from("programs")
    .select("whatsapp_group_url")
    .eq("id", programId)
    .maybeSingle();

  revalidatePath("/registrations");

  return {
    success: true,
    whatsappGroupUrl: registration.status === "waitlisted" ? null : program?.whatsapp_group_url ?? null,
    emailed: !!parentEmail,
    status: registration.status,
    waitlistPosition: registration.waitlist_position,
    amount: registration.amount,
  };
}

/**
 * Turn a confirmed registration into real records: a parent, a student, the link
 * between them, and an enrollment.
 *
 * A family already on file is used, not copied (lib/identity.ts): the parent
 * by phone however it was typed, the child by that parent's child of the same
 * name, and the registration's medical notes are added to that child — so the
 * allergy reaches the register the coach actually reads. A child with the same
 * name under a family it doesn't recognise is returned as `matches` for the
 * Boss to answer "Is this the same Mia?"; she answers with `choice`.
 */
export async function convertRegistration(
  registrationId: string,
  choice: { studentId?: string; createNew?: boolean } = {}
): Promise<{ error: string } | { success: true } | { matches: ChildOnFile[] }> {
  if (!(await signedIn())) return NOT_SIGNED_IN;
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

  const directory = await Directory.load(supabase);
  const family = directory.family({
    phone: reg.parent_phone,
    parentFirst: reg.parent_first_name,
    parentLast: reg.parent_last_name,
    childFirst: reg.child_first_name,
    childLast: reg.child_last_name,
  });

  // The child: the one the Boss picked, the family's own, or a new one — but
  // never a new one without asking while someone of that name is on file.
  let child = reg.student_id ? null : family.child;
  if (choice.studentId) {
    child = family.possible.find((c) => c.id === choice.studentId) ?? null;
    if (!child) return { error: "That child isn't a match for this registration any more. Try again." };
  } else if (!reg.student_id && !child && family.possible.length && !choice.createNew) {
    return { matches: family.possible };
  }

  // Parent — reuse the family's record, whatever format the phone was typed in.
  let parentId = (reg.parent_id as string | null) ?? family.parent?.id ?? null;
  if (!parentId) {
    const { data: newParent, error: parentError } = await supabase
      .from("parents")
      .insert({
        first_name: reg.parent_first_name,
        last_name: reg.parent_last_name,
        phone: normalizePhone(reg.parent_phone) ?? reg.parent_phone,
        email: reg.parent_email,
      })
      .select("id")
      .single();

    if (parentError) return { error: parentError.message };
    parentId = newParent.id;
  }

  // Student
  let studentId = (reg.student_id as string | null) ?? child?.id ?? null;
  if (child) {
    try {
      await mergeIntoChild(supabase, child, {
        grade: reg.child_grade,
        date_of_birth: reg.child_date_of_birth,
        medical_notes: reg.medical_notes,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't update the child's notes." };
    }
  }
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

  // On the roster: the welcome email, with the first practice and group chat.
  await emailWelcome(supabase, {
    enrollmentId: enrollment.id,
    parentId: parentId!,
    childName: reg.child_first_name,
    programId: reg.program_id,
  });

  revalidatePath("/registrations");
  revalidatePath("/students");

  return { success: true };
}

/**
 * Promote the next person off the waitlist, if a seat has actually opened.
 * Re-checks capacity rather than trusting the caller's view of it.
 */
export async function promoteFromWaitlist(registrationId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("registrations")
    .update({ payment_status: paymentStatus })
    .eq("id", registrationId);

  if (error) return { error: error.message };

  revalidatePath("/registrations");
  return { success: true };
}
