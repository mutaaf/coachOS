import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { assignUnrecognisedPayment } from "@/lib/actions/payment-assign";
import { getAssignOptions } from "@/lib/queries/payment-assign";
import { businessMonth } from "@/lib/dates";

/**
 * "Who paid this?" A payment from someone CoachOS doesn't know, put where it
 * belongs — creating the family, child, school and program as needed.
 *
 * It must be hard to get wrong: nothing half-made, no duplicate families or
 * schools from a retyped name, and the money always on the right invoice.
 */

afterEach(truncateAll);

let n = 0;
async function zelle(amount: number, sender = "RAQUEL M GARCIA") {
  const { data } = await admin
    .from("zelle_receipts")
    .insert({ message_id: `assign-${Date.now()}-${++n}`, sender_name: sender, amount, status: "unmatched" })
    .select("id")
    .single();
  return data!.id as string;
}

async function count(table: string) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

async function familyInvoices(parentId: string) {
  const { data: links } = await admin.from("student_parents").select("student_id").eq("parent_id", parentId);
  const { data } = await admin
    .from("invoices")
    .select("id, month, amount, status, programs(name, monthly_fee, schools(name)), students(first_name, last_name), payments(amount, method)")
    .in("student_id", (links || []).map((l) => l.student_id));
  return data!;
}

describe("someone entirely new", () => {
  it("creates the school, program, family and child, bills this month and records the Zelle", async () => {
    const receiptId = await zelle(120);
    const result: any = await assignUnrecognisedPayment({
      source: { kind: "zelle", receiptId },
      parent: { first_name: "Raquel", last_name: "Garcia", phone: "(214) 555-0101" },
      placement: {
        student: { first_name: "Mia" },
        school: { name: "Lakehill Elementary" },
        program: { name: "Fall Soccer", monthly_fee: 120 },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.created.sort()).toEqual(["invoice", "parent", "program", "school", "student"]);
    expect(result.leftoverCents).toBe(0);

    const [inv] = await familyInvoices(result.parentId);
    expect(inv).toMatchObject({
      month: businessMonth(),
      status: "paid",
      students: { first_name: "Mia", last_name: "Garcia" },
      programs: { name: "Fall Soccer", schools: { name: "Lakehill Elementary" } },
    });
    expect(inv.payments).toEqual([{ amount: 120, method: "zelle" }]);

    const { data: receipt } = await admin.from("zelle_receipts").select("status, parent_id").eq("id", receiptId).single();
    expect(receipt).toEqual({ status: "matched", parent_id: result.parentId });
    // Next month's payment from her matches by itself.
    const { data: sender } = await admin.from("zelle_senders").select("parent_id");
    expect(sender).toEqual([{ parent_id: result.parentId }]);
    const { data: parent } = await admin.from("parents").select("phone").eq("id", result.parentId).single();
    expect(parent!.phone).toBe("+12145550101");
  });

  it("leaves nothing behind when it can't finish", async () => {
    const receiptId = await zelle(120);
    const before = await Promise.all(["schools", "programs", "parents", "students"].map(count));
    const result: any = await assignUnrecognisedPayment({
      source: { kind: "zelle", receiptId },
      parent: { first_name: "Raquel", phone: "2145550101" },
      placement: {
        student: { first_name: "Mia" },
        school: { name: "Brand New School" },
        // A new program with no fee: refused before anything is made.
        program: { name: "Fall Soccer", monthly_fee: 0 },
      },
    });
    expect(result.error).toMatch(/monthly fee/);
    expect(await Promise.all(["schools", "programs", "parents", "students"].map(count))).toEqual(before);
    const { data: receipt } = await admin.from("zelle_receipts").select("status").eq("id", receiptId).single();
    expect(receipt!.status).toBe("unmatched");
  });

  it("asks for a phone, and for the child and program when the family is new", async () => {
    const receiptId = await zelle(50);
    expect(
      ((await assignUnrecognisedPayment({
        source: { kind: "zelle", receiptId },
        parent: { first_name: "Raquel", phone: "" },
      })) as any).error
    ).toMatch(/phone/);
    expect(
      ((await assignUnrecognisedPayment({
        source: { kind: "zelle", receiptId },
        parent: { first_name: "Raquel", phone: "2145550101" },
      })) as any).error
    ).toMatch(/child/);
    expect(await count("parents")).toBe(0);
  });
});

describe("never a duplicate", () => {
  it("a 'new' parent whose phone is on file is that family, and their child is that child", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const { data: p } = await admin
      .from("parents")
      .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145550101" })
      .select("id")
      .single();
    const { data: s } = await admin.from("students").insert({ first_name: "Mía", last_name: "Garcia" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });

    const result: any = await assignUnrecognisedPayment({
      source: { kind: "zelle", receiptId: await zelle(100) },
      parent: { first_name: "Rachel", last_name: "G", phone: "214.555.0101" },
      placement: { student: { first_name: "mia" }, program: { id: programId } },
    });
    expect(result.error).toBeUndefined();
    expect(result.parentId).toBe(p!.id);
    expect(result.reusedParent).toBe("Raquel Garcia");
    expect(await count("parents")).toBe(1);
    expect(await count("students")).toBe(1);
    expect((await familyInvoices(p!.id))[0].status).toBe("paid");
  });

  it("a 'new' school or program with an existing name is the existing one", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 90 });
    const { data: school } = await admin.from("schools").select("name").eq("id", schoolId).single();
    const { data: program } = await admin.from("programs").select("name").eq("id", programId).single();

    const result: any = await assignUnrecognisedPayment({
      source: { kind: "manual", amount: 90, method: "cash" },
      parent: { first_name: "Ana", last_name: "Lopez", phone: "2145550199" },
      placement: {
        student: { first_name: "Leo" },
        school: { name: `  ${school!.name.toUpperCase()} ` },
        program: { name: program!.name.toLowerCase(), monthly_fee: 500 },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.created.sort()).toEqual(["invoice", "parent", "student"]);
    expect(await count("schools")).toBe(1);
    expect(await count("programs")).toBe(1);
    // The existing program's fee, not the one typed for a "new" one.
    const [inv] = await familyInvoices(result.parentId);
    expect(inv.amount).toBe(90);
    expect(inv.payments).toEqual([{ amount: 90, method: "cash" }]);
  });
});

describe("a family already on file", () => {
  it("with something owed, the money goes on it — nothing else needed", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const placed: any = await assignUnrecognisedPayment({
      source: { kind: "manual", amount: 40, method: "cash" },
      parent: { first_name: "Ana", phone: "2145550199" },
      placement: { student: { first_name: "Leo" }, program: { id: programId } },
    });
    const result: any = await assignUnrecognisedPayment({
      source: { kind: "zelle", receiptId: await zelle(60, "ANA LOPEZ") },
      parent: { id: placed.parentId },
    });
    expect(result.error).toBeUndefined();
    const [inv] = await familyInvoices(placed.parentId);
    expect(inv.status).toBe("paid");
    expect(inv.payments.map((p: any) => p.amount).sort()).toEqual([40, 60]);
  });

  it("with nothing owed, bills the child and program it's for, and keeps the rest as credit", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const { data: p } = await admin.from("parents").insert({ first_name: "Ana", last_name: "Lopez", phone: "+12145550199" }).select("id").single();
    const receiptId = await zelle(150, "ANA LOPEZ");

    const result: any = await assignUnrecognisedPayment({
      source: { kind: "zelle", receiptId },
      parent: { id: p!.id },
      placement: { student: { first_name: "Leo" }, program: { id: programId } },
    });
    expect(result.error).toBeUndefined();
    expect(result.leftoverCents).toBe(5000);
    const { data: receipt } = await admin.from("zelle_receipts").select("note").eq("id", receiptId).single();
    expect(receipt!.note).toMatch(/\$50\.00 more than was owed — kept as credit/);
  });

  it("a payment already recorded can't be recorded again", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const receiptId = await zelle(100);
    const input = {
      source: { kind: "zelle" as const, receiptId },
      parent: { first_name: "Raquel", phone: "2145550101" },
      placement: { student: { first_name: "Mia" }, program: { id: programId } },
    };
    expect(((await assignUnrecognisedPayment(input)) as any).error).toBeUndefined();
    expect(((await assignUnrecognisedPayment(input)) as any).error).toMatch(/already been recorded/);
    expect(await count("payments")).toBe(1);
  });
});

describe("the choices offered", () => {
  it("lists families with their children and what they owe, and schools with their programs", async () => {
    const { schoolId, programId } = await seedProgram({ monthlyFee: 100 });
    const placed: any = await assignUnrecognisedPayment({
      source: { kind: "manual", amount: 30, method: "cash" },
      parent: { first_name: "Ana", last_name: "Lopez", phone: "2145550199" },
      placement: { student: { first_name: "Leo" }, program: { id: programId } },
    });
    const options = await getAssignOptions();
    expect(options.families).toEqual([
      expect.objectContaining({
        id: placed.parentId,
        name: "Ana Lopez",
        children: [expect.objectContaining({ first_name: "Leo" })],
        owedCents: 7000,
        billedThisMonth: true,
      }),
    ]);
    expect(options.schools).toEqual([
      expect.objectContaining({ id: schoolId, programs: [expect.objectContaining({ id: programId, monthly_fee: 100 })] }),
    ]);
  });
});
