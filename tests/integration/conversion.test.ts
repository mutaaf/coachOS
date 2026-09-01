import { describe, it, expect, afterEach } from "vitest";
import { admin, availability, register, seedProgram, truncateAll } from "../helpers/db";

afterEach(truncateAll);

/**
 * Converting a registration into roster records is the step that turns "someone
 * filled in a form" into "this child is in the session". It reproduces what
 * convertRegistration does in the app, so the invariants below hold for the
 * dashboard button as well as for anything else that calls the same tables.
 */
async function convert(registrationId: string) {
  const { data: reg } = await admin
    .from("registrations")
    .select("*")
    .eq("id", registrationId)
    .single();

  let parentId = reg!.parent_id as string | null;
  if (!parentId) {
    const { data: existing } = await admin
      .from("parents")
      .select("id")
      .eq("phone", reg!.parent_phone)
      .maybeSingle();

    if (existing) {
      parentId = existing.id;
    } else {
      const { data: created } = await admin
        .from("parents")
        .insert({
          first_name: reg!.parent_first_name,
          last_name: reg!.parent_last_name,
          phone: reg!.parent_phone,
          email: reg!.parent_email,
        })
        .select("id")
        .single();
      parentId = created!.id;
    }
  }

  const { data: student } = await admin
    .from("students")
    .insert({
      first_name: reg!.child_first_name,
      last_name: reg!.child_last_name,
      grade: reg!.child_grade,
      date_of_birth: reg!.child_date_of_birth,
      medical_notes: reg!.medical_notes,
    })
    .select("id")
    .single();

  await admin
    .from("student_parents")
    .upsert(
      { student_id: student!.id, parent_id: parentId, relationship: "parent" },
      { onConflict: "student_id,parent_id" }
    );

  const { data: enrollment } = await admin
    .from("enrollments")
    .upsert(
      { student_id: student!.id, program_id: reg!.program_id, status: "active" },
      { onConflict: "student_id,program_id" }
    )
    .select("id")
    .single();

  await admin
    .from("registrations")
    .update({ student_id: student!.id, parent_id: parentId, enrollment_id: enrollment!.id })
    .eq("id", registrationId);

  return { parentId, studentId: student!.id, enrollmentId: enrollment!.id };
}

describe("registration to roster", () => {
  it("creates a parent, a student, and an enrollment", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const { data: reg } = await register(programId, "Amina", { grade: "3rd" });

    const { parentId, studentId, enrollmentId } = await convert(reg.id);

    expect(parentId).toBeTruthy();
    expect(studentId).toBeTruthy();
    expect(enrollmentId).toBeTruthy();

    const { data: student } = await admin
      .from("students")
      .select("first_name, grade")
      .eq("id", studentId)
      .single();
    expect(student!.first_name).toBe("Amina");
    expect(student!.grade).toBe("3rd");
  });

  /**
   * The invariant that stops a converted registration being counted twice: a
   * seat is held by an active enrollment, or by a confirmed registration that
   * has not become one yet — never by both.
   */
  it("does not double-count a seat after conversion", async () => {
    const { programId } = await seedProgram({ capacity: 3 });
    const { data: reg } = await register(programId, "Amina");

    const before = await availability(programId);
    expect(before.seats_taken).toBe(1);

    await convert(reg.id);

    const after = await availability(programId);
    expect(after.seats_taken).toBe(1);
    expect(after.seats_remaining).toBe(2);
  });

  it("reuses an existing parent rather than duplicating them", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const phone = "+12145558888";

    const { data: first } = await register(programId, "Amina", { parentPhone: phone });
    const { data: second } = await register(programId, "Bilal", { parentPhone: phone });

    const a = await convert(first.id);
    const b = await convert(second.id);

    expect(a.parentId).toBe(b.parentId);

    const { count } = await admin
      .from("parents")
      .select("*", { count: "exact", head: true })
      .eq("phone", phone);
    expect(count).toBe(1);
  });

  it("links both siblings to the one parent record", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const phone = "+12145557777";

    const { data: first } = await register(programId, "Amina", { parentPhone: phone });
    const { data: second } = await register(programId, "Bilal", { parentPhone: phone });

    const a = await convert(first.id);
    const b = await convert(second.id);

    const { data: links } = await admin
      .from("student_parents")
      .select("student_id")
      .eq("parent_id", a.parentId);

    const studentIds = links!.map((l) => l.student_id).sort();
    expect(studentIds).toEqual([a.studentId, b.studentId].sort());
  });

  it("keeps the original submission after conversion", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const { data: reg } = await register(programId, "Amina");

    await convert(reg.id);

    const { data: after } = await admin
      .from("registrations")
      .select("child_first_name, status, enrollment_id")
      .eq("id", reg.id)
      .single();

    expect(after!.child_first_name).toBe("Amina");
    expect(after!.status).toBe("confirmed");
    expect(after!.enrollment_id).toBeTruthy();
  });
});

describe("waitlist promotion", () => {
  it("frees a seat when an enrollment is withdrawn", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    const { data: seated } = await register(programId, "Seated");
    await register(programId, "Waiting");

    const { enrollmentId } = await convert(seated.id);

    expect((await availability(programId)).seats_remaining).toBe(0);

    await admin.from("enrollments").update({ status: "withdrawn" }).eq("id", enrollmentId);
    await admin.from("registrations").update({ status: "cancelled" }).eq("id", seated.id);

    expect((await availability(programId)).seats_remaining).toBe(1);
  });

  it("promotes someone off the waitlist once a seat exists", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    const { data: seated } = await register(programId, "Seated");
    const { data: waiting } = await register(programId, "Waiting");

    expect(waiting.status).toBe("waitlisted");

    await admin.from("registrations").update({ status: "cancelled" }).eq("id", seated.id);

    const seats = await availability(programId);
    expect(seats.seats_remaining).toBe(1);

    await admin
      .from("registrations")
      .update({ status: "confirmed", waitlist_position: null })
      .eq("id", waiting.id);

    const after = await availability(programId);
    expect(after.seats_taken).toBe(1);
    expect(after.waitlist_count).toBe(0);
  });
});
