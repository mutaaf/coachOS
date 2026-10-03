"use server";

import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Registration } from "@/types/database";
import { Directory, mergeIntoChild, phoneKey, sameName, type ChildOnFile } from "@/lib/identity";
import { normalizePhone, NOT_A_PHONE } from "@/lib/roster";
import { emailWelcome } from "@/lib/parent-emails";
import { queueWelcome, tellSeatOpened, welcomeRegistration } from "@/lib/family-messages";
import { billFirstMonth } from "@/lib/invoices";

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
  // Their "you're in" email, and a message in the Outbox for the Boss to send.
  // Never in the way: each logs a failure, never throws.
  if (made) await welcomeRegistration(supabase, made.id);

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
 * between them, an enrollment, and this month's invoice.
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

  // On the roster is billed from today, not from the next run on the 1st.
  try {
    await billFirstMonth(supabase, { studentId: studentId!, programId: reg.program_id, parentId: parentId! });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Added to the roster, but the first bill couldn't be made." };
  }

  // On the roster: the welcome email, with the first practice and group chat,
  // and the welcome message in the Outbox.
  const welcome = {
    enrollmentId: enrollment.id,
    parentId: parentId!,
    childName: reg.child_first_name,
    programId: reg.program_id,
  };
  await emailWelcome(supabase, welcome);
  await queueWelcome(supabase, welcome);

  revalidatePath("/registrations");
  revalidatePath("/students");

  return { success: true };
}

type Supabase = ReturnType<typeof createAdminSupabase>;

/** Whether the program has a free seat — checked here, not trusted from the page. */
async function seatFree(supabase: Supabase, programId: string): Promise<{ error: string } | { free: boolean }> {
  const { data, error } = await supabase
    .from("program_availability")
    .select("seats_remaining")
    .eq("program_id", programId)
    .maybeSingle();
  if (error) return { error: error.message };
  return { free: !!data && data.seats_remaining >= 1 };
}

/** The family at the front of a program's waitlist. */
async function nextInLine(supabase: Supabase, programId: string) {
  const { data } = await supabase
    .from("registrations")
    .select("id, child_first_name, child_last_name, waitlist_position")
    .eq("program_id", programId)
    .eq("status", "waitlisted")
    .order("waitlist_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Number the waitlist 1, 2, 3… again, in the order it is already in. Without
 * this, when #1 got a seat the next family still showed as #2, with nobody
 * ahead of them.
 */
async function renumberWaitlist(supabase: Supabase, programId: string) {
  const { data: waiting } = await supabase
    .from("registrations")
    .select("id, waitlist_position")
    .eq("program_id", programId)
    .eq("status", "waitlisted")
    .order("waitlist_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  for (const [i, r] of (waiting || []).entries()) {
    if (r.waitlist_position !== i + 1) {
      await supabase.from("registrations").update({ waitlist_position: i + 1 }).eq("id", r.id);
    }
  }
}

/**
 * Give a registration a seat. One that was on the roster before it was
 * cancelled goes back on it, and is billed for this month again.
 */
async function takeSeat(supabase: Supabase, registrationId: string): Promise<{ error: string } | null> {
  const { data: reg, error } = await supabase
    .from("registrations")
    .update({ status: "confirmed", waitlist_position: null })
    .eq("id", registrationId)
    .select("program_id, enrollment_id, student_id, parent_id")
    .single();
  if (error) return { error: error.message };

  if (reg.enrollment_id) {
    await supabase.from("enrollments").update({ status: "active" }).eq("id", reg.enrollment_id);
    if (reg.student_id && reg.parent_id) {
      await billFirstMonth(supabase, { studentId: reg.student_id, programId: reg.program_id, parentId: reg.parent_id });
    }
  }
  return null;
}

/**
 * Give a waiting family the seat that has opened. The waitlist is first come,
 * first served: if someone is ahead of them, this says who (`ahead`) and
 * changes nothing, until the Boss says to go out of turn.
 */
export async function promoteFromWaitlist(registrationId: string, opts: { outOfTurn?: boolean } = {}) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("id, program_id, status")
    .eq("id", registrationId)
    .single();

  if (regError || !reg) return { error: regError?.message ?? "Registration not found." };
  if (reg.status !== "waitlisted") return { error: "That registration is not on the waitlist." };

  const first = await nextInLine(supabase, reg.program_id);
  if (first && first.id !== reg.id && !opts.outOfTurn) {
    return {
      ahead: {
        name: `${first.child_first_name} ${first.child_last_name}`.trim(),
        position: first.waitlist_position ?? 1,
      },
    };
  }

  const seat = await seatFree(supabase, reg.program_id);
  if ("error" in seat) return seat;
  if (!seat.free) return { error: "That program is still full. Free a seat first." };

  const taken = await takeSeat(supabase, registrationId);
  if (taken) return taken;
  await renumberWaitlist(supabase, reg.program_id);
  // /join promised them a message the moment a spot opened.
  await tellSeatOpened(supabase, registrationId);

  revalidatePath("/registrations");
  revalidatePath("/students");
  return { success: true };
}

/** Give the open seat to whoever has waited longest for this program. */
export async function promoteNextInLine(programId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const first = await nextInLine(supabase, programId);
  if (!first) return { error: "Nobody is waiting for this program." };

  const seat = await seatFree(supabase, programId);
  if ("error" in seat) return seat;
  if (!seat.free) return { error: "That program is still full. Free a seat first." };

  const taken = await takeSeat(supabase, first.id);
  if (taken) return taken;
  await renumberWaitlist(supabase, programId);
  await tellSeatOpened(supabase, first.id);

  revalidatePath("/registrations");
  revalidatePath("/students");
  return { success: true, name: `${first.child_first_name} ${first.child_last_name}`.trim() };
}

/**
 * Cancel a registration. Cancelling used to leave a child who was already on
 * the roster enrolled — and billed every month. With `withdraw`, they come off
 * the roster too, and the bill that isn't due yet and has nothing paid on it
 * goes with them. Money already paid, and bills already overdue, are never
 * touched: those are for the Boss to decide on Payments.
 */
export async function cancelRegistration(registrationId: string, opts: { withdraw?: boolean } = {}) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("id, program_id, status, enrollment_id, student_id")
    .eq("id", registrationId)
    .single();
  if (regError || !reg) return { error: regError?.message ?? "Registration not found." };

  const { error } = await supabase
    .from("registrations")
    .update({ status: "cancelled", waitlist_position: null })
    .eq("id", registrationId);
  if (error) return { error: error.message };

  if (opts.withdraw && reg.enrollment_id) {
    await supabase.from("enrollments").update({ status: "withdrawn" }).eq("id", reg.enrollment_id).eq("status", "active");

    const { data: bills } = await supabase
      .from("invoices")
      .select("id, stripe_invoice_id, payments(id)")
      .eq("student_id", reg.student_id)
      .eq("program_id", reg.program_id)
      .eq("status", "pending");
    for (const bill of bills || []) {
      if ((bill.payments as unknown[] | null)?.length) continue;
      // One already sent through Stripe is out with the family; waive it
      // rather than lose track of it.
      if (bill.stripe_invoice_id) await supabase.from("invoices").update({ status: "waived" }).eq("id", bill.id);
      else await supabase.from("invoices").delete().eq("id", bill.id);
    }
  }

  if (reg.status === "waitlisted") await renumberWaitlist(supabase, reg.program_id);

  revalidatePath("/registrations");
  revalidatePath("/students");
  revalidatePath("/payments");
  return { success: true };
}

/**
 * Undo a cancel. The family gets their seat back if one is free — back on the
 * roster and billed, if they were on it — and otherwise goes to the back of
 * the waitlist. `status` says which.
 */
export async function restoreRegistration(registrationId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("id, program_id, status, enrollment_id")
    .eq("id", registrationId)
    .single();
  if (regError || !reg) return { error: regError?.message ?? "Registration not found." };
  if (reg.status !== "cancelled") return { error: "Only a cancelled registration can be restored." };

  // Left on the roster when cancelled: they still hold their seat.
  let stillEnrolled = false;
  if (reg.enrollment_id) {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("status")
      .eq("id", reg.enrollment_id)
      .maybeSingle();
    stillEnrolled = enrollment?.status === "active";
  }

  const seat = await seatFree(supabase, reg.program_id);
  if ("error" in seat) return seat;

  if (stillEnrolled || seat.free) {
    const taken = await takeSeat(supabase, registrationId);
    if (taken) return taken;
    revalidatePath("/registrations");
    revalidatePath("/students");
    revalidatePath("/payments");
    return { success: true, status: "confirmed" as const };
  }

  const { data: last } = await supabase
    .from("registrations")
    .select("waitlist_position")
    .eq("program_id", reg.program_id)
    .eq("status", "waitlisted")
    .order("waitlist_position", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("registrations")
    .update({ status: "waitlisted", waitlist_position: (last?.waitlist_position ?? 0) + 1 })
    .eq("id", registrationId);
  if (error) return { error: error.message };

  revalidatePath("/registrations");
  return { success: true, status: "waitlisted" as const };
}

export async function setRegistrationStatus(
  registrationId: string,
  // Cancelling goes through cancelRegistration, which can take the child off
  // the roster; the waitlist moves only through promoteFromWaitlist.
  status: "pending" | "confirmed" | "declined"
) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: reg, error } = await supabase
    .from("registrations")
    .update({ status, waitlist_position: null })
    .eq("id", registrationId)
    .select("program_id")
    .single();

  if (error) return { error: error.message };
  await renumberWaitlist(supabase, reg.program_id);

  revalidatePath("/registrations");
  return { success: true };
}
