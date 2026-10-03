import { describe, it, expect, afterEach } from "vitest";
import { admin, register, seedProgram, truncateAll } from "../helpers/db";
import { importRows, rowsFromCsv, splitName, type RosterRow } from "@/lib/roster";
import { importRoster } from "@/lib/actions/roster-import";
import { convertRegistration } from "@/lib/actions/registrations";
import { createParent, createStudent } from "@/lib/actions/students";
import { createSchool } from "@/lib/actions/schools";
import { bulkCreateParents, bulkCreateSchools, bulkCreateStudents } from "@/lib/actions/bulk-import";
import { convertLeadToSchool, createLead } from "@/lib/actions/leads";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * The same child, parent or school must not be created twice, whichever way
 * they come in (issue #15). A second Mia Garcia is billed twice, splits the
 * family's history, and — the one that matters — the EpiPen note from her
 * registration went onto the copy while the coach's register showed the
 * original with no note.
 */

const db = admin as unknown as OpsClient;

afterEach(async () => {
  await admin.from("lead_activities").delete().not("id", "is", null);
  await admin.from("leads").delete().not("id", "is", null);
  await truncateAll();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

async function count(table: string) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true });
  return count;
}

/** Mia Garcia and her mother, already on the roster with the phone typed one way. */
async function seedMia() {
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "(915) 500-2487" })
    .select("id")
    .single();
  const { data: child } = await admin
    .from("students")
    .insert({ first_name: "Mia", last_name: "Garcia", grade: "K" })
    .select("id")
    .single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id, relationship: "parent" });
  return { parentId: parent!.id as string, childId: child!.id as string };
}

describe("adding a registration to the roster", () => {
  it("finds the family on file when the phone was typed differently, and the allergy note reaches her", async () => {
    const mia = await seedMia();
    const { programId } = await seedProgram();
    await register(programId, "Mia", {
      childLastName: "Garcia",
      parentFirstName: "Raquel",
      parentLastName: "Garcia",
      parentPhone: "9155002487",
    });
    const { data: reg } = await admin.from("registrations").select("id").eq("program_id", programId).single();
    await admin.from("registrations").update({ medical_notes: "Peanut allergy — EpiPen in her bag" }).eq("id", reg!.id);

    const result = await convertRegistration(reg!.id);
    expect(result).toEqual({ success: true });

    expect(await count("students")).toBe(1);
    expect(await count("parents")).toBe(1);
    const { data: child } = await admin.from("students").select("medical_notes").eq("id", mia.childId).single();
    expect(child!.medical_notes).toContain("EpiPen");
    const { data: enrolled } = await admin.from("enrollments").select("student_id").eq("program_id", programId);
    expect(enrolled).toEqual([{ student_id: mia.childId }]);
  });

  it("asks before using a child with the same name under a family it doesn't recognise", async () => {
    const mia = await seedMia();
    const { programId } = await seedProgram();
    await register(programId, "Mía", {
      childLastName: "García",
      parentFirstName: "Luis",
      parentLastName: "Garcia",
      parentPhone: "2145550199",
    });
    const { data: reg } = await admin.from("registrations").select("id").eq("program_id", programId).single();

    const asked = (await convertRegistration(reg!.id)) as any;
    expect(asked.matches?.map((m: any) => m.id)).toEqual([mia.childId]);
    expect(await count("enrollments")).toBe(0);

    // "Yes, that's her": her father is linked to the child already on file.
    expect(await convertRegistration(reg!.id, { studentId: mia.childId })).toEqual({ success: true });
    expect(await count("students")).toBe(1);
    const { data: links } = await admin.from("student_parents").select("parent_id").eq("student_id", mia.childId);
    expect(links).toHaveLength(2);
  });

  it("adds a new child when the Boss says it's someone else", async () => {
    await seedMia();
    const { programId } = await seedProgram();
    await register(programId, "Mia", { childLastName: "Garcia", parentFirstName: "Ana", parentPhone: "2145550123" });
    const { data: reg } = await admin.from("registrations").select("id").eq("program_id", programId).single();

    expect(await convertRegistration(reg!.id, { createNew: true })).toEqual({ success: true });
    expect(await count("students")).toBe(2);
  });
});

describe("importing a roster again", () => {
  const row = (over: Partial<RosterRow> = {}): RosterRow => ({
    child_first_name: "Mia",
    child_last_name: "Garcia",
    grade: "K",
    parent_first_name: "Raquel",
    parent_last_name: "Garcia",
    parent_phone: "(915) 500-2487",
    parent_email: null,
    ...over,
  });

  it("keeps the same child when the family's phone number has changed", async () => {
    const { programId } = await seedProgram();
    await importRows(db, programId, [row()]);
    const again = await importRows(db, programId, [row({ parent_phone: "214-555-0177" })]);

    expect(again.alreadyEnrolled).toBe(1);
    expect(await count("students")).toBe(1);
    expect(await count("parents")).toBe(1);
  });

  it("keeps the same child when one list has her middle name and the other doesn't", async () => {
    const { programId } = await seedProgram();
    await importRows(db, programId, rowsFromCsv("Child,Parent,Phone\nMia Sofia Garcia,Raquel Garcia,915-500-2487\n")!);
    await importRows(db, programId, [row({ child_first_name: "Mia" })]);

    expect(await count("students")).toBe(1);
    const { data } = await admin.from("students").select("first_name, last_name").single();
    expect(data).toEqual({ first_name: "Mia Sofia", last_name: "Garcia" });
  });

  it("keeps every word before the last as the first name", () => {
    expect(splitName("Mia Sofia Garcia")).toEqual(["Mia Sofia", "Garcia"]);
    expect(splitName("Mia")).toEqual(["Mia", null]);
  });

  it("puts a list for an existing school on that school, however its name was typed", async () => {
    const { data: school } = await admin
      .from("schools")
      .insert({ name: "St. Mary’s Montaña Academy", status: "active" })
      .select("id")
      .single();

    const result = (await importRoster(
      { newSchoolName: "st marys montana academy", newProgram: { name: "Fall", monthlyFee: 100 } },
      [row()]
    )) as any;
    expect(result.schoolId).toBe(school!.id);
    expect(await count("schools")).toBe(1);
  });
});

describe("Add Student and Add Parent", () => {
  it("asks 'is this the same Mia?' instead of adding her again", async () => {
    const mia = await seedMia();

    const asked = (await createStudent(form({ first_name: "mía", last_name: "GARCIA" }))) as any;
    expect(asked.matches?.map((m: any) => m.id)).toEqual([mia.childId]);
    expect(await count("students")).toBe(1);
  });

  it("puts a new medical note on the child already on file when the Boss says it's her", async () => {
    const mia = await seedMia();

    const result = (await createStudent(
      form({ first_name: "Mia", last_name: "Garcia", medical_notes: "Asthma inhaler", existing_student_id: mia.childId })
    )) as any;
    expect(result.data?.id).toBe(mia.childId);
    expect(await count("students")).toBe(1);
    const { data } = await admin.from("students").select("medical_notes").eq("id", mia.childId).single();
    expect(data!.medical_notes).toBe("Asthma inhaler");
  });

  it("adds a second child with the same name when the Boss says it's someone else", async () => {
    await seedMia();
    const result = (await createStudent(form({ first_name: "Mia", last_name: "Garcia", confirm_new: "1" }))) as any;
    expect(result.data?.id).toBeTruthy();
    expect(await count("students")).toBe(2);
  });

  it("asks before adding a parent whose phone is already on file", async () => {
    const mia = await seedMia();
    const asked = (await createParent(form({ first_name: "Raquel", last_name: "Garcia", phone: "+1 915 500 2487" }))) as any;
    expect(asked.matches?.map((m: any) => m.id)).toEqual([mia.parentId]);
    expect(await count("parents")).toBe(1);
  });
});

describe("Bulk Import", () => {
  it("skips a child, parent or school already on file, and says so", async () => {
    await seedMia();
    await admin.from("schools").insert({ name: "Lincoln Elementary", status: "active" });

    const students = await bulkCreateStudents([
      { first_name: "Mia", last_name: "García" },
      { first_name: "Leo", last_name: "Garcia" },
      { first_name: "Leo", last_name: "Garcia" },
    ]);
    expect(students.created).toBe(1);
    expect(students.errors.map((e) => e.row)).toEqual([0, 2]);

    const parents = await bulkCreateParents([
      { first_name: "Raquel", last_name: "Garcia", phone: "915.500.2487" },
      { first_name: "Luis", last_name: "Garcia", phone: "2145550199" },
    ]);
    expect(parents.created).toBe(1);
    expect(parents.errors.map((e) => e.row)).toEqual([0]);

    const schools = await bulkCreateSchools([{ name: "LINCOLN ELEMENTARY" }, { name: "Roosevelt" }]);
    expect(schools.created).toBe(1);
    expect(schools.errors.map((e) => e.row)).toEqual([0]);
  });

  // Issue #33: the parent's name and phone were asked for and thrown away, so
  // the child had nobody to message and no invoices.
  it("saves each student's parent and links them, matching a parent already on file by phone", async () => {
    const mia = await seedMia();

    const result = await bulkCreateStudents([
      { first_name: "Leo", last_name: "Garcia", parent_name: "Someone Else", parent_phone: "(915) 500-2487" },
      { first_name: "Omar", last_name: "Khan", grade: "3rd", parent_name: "Ayesha Khan", parent_phone: "214-555-0150" },
      { first_name: "Zara", last_name: "Khan", parent_name: "Ayesha Khan", parent_phone: "+1 214 555 0150" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.created).toBe(3);

    const parentsOf = async (first: string) => {
      const { data } = await admin
        .from("students")
        .select("student_parents(parents(id, first_name, last_name, phone))")
        .eq("first_name", first)
        .single();
      return (data!.student_parents as any[]).map((sp) => sp.parents);
    };

    expect((await parentsOf("Leo")).map((p) => p.id)).toEqual([mia.parentId]);
    const omar = await parentsOf("Omar");
    expect(omar).toMatchObject([{ first_name: "Ayesha", last_name: "Khan", phone: "+12145550150" }]);
    expect((await parentsOf("Zara")).map((p) => p.id)).toEqual([omar[0].id]);
    expect(await count("parents")).toBe(2);
  });

  it("says what's wrong with a parent it can't save instead of dropping them", async () => {
    const result = await bulkCreateStudents([
      { first_name: "Omar", last_name: "Khan", parent_name: "Ayesha Khan", parent_phone: "555-01" },
      { first_name: "Zara", last_name: "Khan", parent_name: "Ayesha Khan" },
      { first_name: "Adam", last_name: "Khan", parent_phone: "2145550150" },
    ]);
    expect(result.created).toBe(0);
    expect(result.errors.map((e) => e.row)).toEqual([0, 1, 2]);
    expect(await count("students")).toBe(0);
    expect(await count("parents")).toBe(0);
  });
});

describe("schools and leads", () => {
  it("won't add a school that's already on the list", async () => {
    await admin.from("schools").insert({ name: "Lincoln Elementary", status: "active" });
    const result = await createSchool(form({ name: "lincoln elementary" }));
    expect(result).toHaveProperty("error");
    expect(await count("schools")).toBe(1);
  });

  it("converting a lead for a school already on the list uses that school", async () => {
    await admin.from("schools").insert({ name: "Lincoln Elementary", status: "active" });
    const { data: lead } = await admin.from("leads").insert({ school_name: "Lincoln  elementary" }).select("id").single();

    await convertLeadToSchool(lead!.id);
    expect(await count("schools")).toBe(1);
    const { data } = await admin.from("leads").select("stage").eq("id", lead!.id).single();
    expect(data!.stage).toBe("signed");
  });

  it("converting the same lead twice makes one school", async () => {
    const { data: lead } = await admin.from("leads").insert({ school_name: "Roosevelt" }).select("id").single();
    await Promise.all([convertLeadToSchool(lead!.id), convertLeadToSchool(lead!.id)]);
    expect(await count("schools")).toBe(1);
  });

  it("adding the same lead twice makes one", async () => {
    await createLead(form({ school_name: "Roosevelt" }));
    const again = await createLead(form({ school_name: "roosevelt" }));
    expect(again).toHaveProperty("error");
    expect(await count("leads")).toBe(1);
  });
});
