import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { createProgram, updateProgram, updateProgramStatus } from "@/lib/actions/programs";
import { archiveSchool } from "@/lib/actions/schools";
import { importRoster } from "@/lib/actions/roster-import";

/**
 * Issue #12: five ways a family was billed for something they didn't owe —
 * a free program charged $120, programs billed after they ended or were
 * cancelled, a school's families billed after it was archived, and a child
 * who joined mid-month billed overdue on day one.
 */

afterEach(truncateAll);

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

let n = 0;
async function enrolled(programId: string, enrolledAt?: string) {
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Sara", last_name: "Yusuf", phone: `+1214555${String(++n).padStart(4, "0")}` })
    .select("id")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: "Amina", last_name: "Yusuf" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({
    student_id: s!.id,
    program_id: programId,
    status: "active",
    ...(enrolledAt ? { enrolled_at: enrolledAt } : {}),
  });
  return s!.id as string;
}

async function invoicesFor(programId: string) {
  const { data } = await admin.from("invoices").select("amount, month, due_date").eq("program_id", programId).order("month");
  return data!;
}

async function programFee(schoolId: string) {
  const { data } = await admin.from("programs").select("monthly_fee").eq("school_id", schoolId).single();
  return data ? Number(data.monthly_fee) : null;
}

describe("a program's fee", () => {
  it("of 0 is saved as free, not $120", async () => {
    const { schoolId } = await seedProgram();
    const result = await createProgram(form({ school_id: schoolId, name: "Scholarship", monthly_fee: "0" }));
    expect(result).toMatchObject({ success: true });
    const { data } = await admin.from("programs").select("monthly_fee").eq("name", "Scholarship").single();
    expect(Number(data!.monthly_fee)).toBe(0);
  });

  it("left blank or not a number is refused rather than guessed", async () => {
    const { schoolId } = await seedProgram();
    for (const fee of ["", "abc", "-5"]) {
      const result = await createProgram(form({ school_id: schoolId, name: `Fee ${fee}`, monthly_fee: fee }));
      expect(result).toHaveProperty("error");
    }
    const { count } = await admin.from("programs").select("*", { count: "exact", head: true }).like("name", "Fee%");
    expect(count).toBe(0);
  });

  it("edited to 0 stays 0", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 150 });
    await updateProgram(programId, form({ school_id: schoolId, name: "Now free", monthly_fee: "0" }));
    expect(await programFee(schoolId)).toBe(0);
  });

  it("of 0 can be set from the roster import too", async () => {
    const { schoolId } = await seedProgram();
    const result = await importRoster({ schoolId, newProgram: { name: "Free clinic", monthlyFee: 0 } }, []);
    expect(result).toMatchObject({ success: true });
    const { data } = await admin.from("programs").select("monthly_fee").eq("name", "Free clinic").single();
    expect(Number(data!.monthly_fee)).toBe(0);
  });

  it("of 0 means no invoices", async () => {
    const { programId } = await seedProgram({ monthlyFee: 0 });
    await enrolled(programId, "2026-08-01T12:00:00Z");
    await generateMonthlyInvoices("2026-09");
    expect(await invoicesFor(programId)).toEqual([]);
  });
});

describe("a program's dates", () => {
  it("must end on or after the day it starts", async () => {
    const { schoolId, programId } = await seedProgram();
    const bad = { school_id: schoolId, name: "Backwards", monthly_fee: "100", start_date: "2026-12-01", end_date: "2026-09-01" };
    expect(await createProgram(form(bad))).toHaveProperty("error");
    expect(await updateProgram(programId, form(bad))).toHaveProperty("error");
  });

  it("bound the months it is billed for", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await admin.from("programs").update({ start_date: "2026-09-15", end_date: "2026-12-15" }).eq("id", programId);
    await enrolled(programId, "2026-08-01T12:00:00Z");

    for (const month of ["2026-08", "2026-09", "2026-12", "2027-01", "2027-02"]) {
      await generateMonthlyInvoices(month);
    }

    expect((await invoicesFor(programId)).map((i) => i.month)).toEqual(["2026-09", "2026-12"]);
  });
});

describe("a program that is over", () => {
  it.each(["completed", "cancelled"] as const)("is not billed once %s", async (status) => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-08-01T12:00:00Z");
    await updateProgramStatus(programId, status);
    await generateMonthlyInvoices("2026-09");
    expect(await invoicesFor(programId)).toEqual([]);
  });
});

describe("an archived school", () => {
  it("is not billed", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-08-01T12:00:00Z");
    await archiveSchool(schoolId);
    await generateMonthlyInvoices("2026-09");
    expect(await invoicesFor(programId)).toEqual([]);
  });

  it("can end its enrollments as it goes", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-08-01T12:00:00Z");
    const other = await seedProgram({ monthlyFee: 100 });
    await enrolled(other.programId, "2026-08-01T12:00:00Z");

    await archiveSchool(schoolId, { endEnrollments: true });

    const { data: here } = await admin.from("enrollments").select("status").eq("program_id", programId);
    expect(here!.map((e) => e.status)).toEqual(["completed"]);
    const { data: there } = await admin.from("enrollments").select("status").eq("program_id", other.programId);
    expect(there!.map((e) => e.status)).toEqual(["active"]);
  });

  it("keeps its enrollments when the Boss says so", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-08-01T12:00:00Z");
    await archiveSchool(schoolId);
    const { data } = await admin.from("enrollments").select("status").eq("program_id", programId);
    expect(data!.map((e) => e.status)).toEqual(["active"]);
  });
});

describe("a child who joins mid-month", () => {
  it("has a week to pay, instead of being overdue the day the invoice is made", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    // Noon in Dallas on Oct 2.
    await enrolled(programId, "2026-10-02T17:00:00Z");
    await generateMonthlyInvoices("2026-10");
    expect(await invoicesFor(programId)).toEqual([expect.objectContaining({ month: "2026-10", due_date: "2026-10-09" })]);
  });

  it("is due on the 1st in the months after", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-10-02T17:00:00Z");
    await generateMonthlyInvoices("2026-11");
    expect(await invoicesFor(programId)).toEqual([expect.objectContaining({ due_date: "2026-11-01" })]);
  });

  it("joining late in the evening counts the day in Dallas, not UTC", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    // 9pm Oct 2 in Dallas is already Oct 3 in UTC.
    await enrolled(programId, "2026-10-03T02:00:00Z");
    await generateMonthlyInvoices("2026-10");
    expect(await invoicesFor(programId)).toEqual([expect.objectContaining({ due_date: "2026-10-09" })]);
  });
});
