import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { sendBulkMessages } from "@/lib/actions/messages";
import { getInvoices } from "@/lib/queries/payments";
import { getFamily, getFamilyBalances } from "@/lib/queries/families";
import { businessMonth } from "@/lib/dates";

/**
 * Issue #36: "What does the Garcia family owe?" took three screens and adding
 * it up herself. Invoices showed the full fee, not what was left, and nothing
 * tied a message to the family it went to. Now a family has one page with the
 * children, guardians, what they owe, their messages and their pay link, and
 * Parents and invoices each show a balance.
 */

afterEach(truncateAll);

const thisMonth = businessMonth();
let n = 0;

/** Raquel and Miguel Garcia, both parents of Mia and Leo, each on a $90 program. */
async function garcias() {
  const { programId } = await seedProgram({ monthlyFee: 90 });
  const phone = () => `+1214555${String(++n).padStart(4, "0")}`;
  const { data: parents, error } = await admin
    .from("parents")
    .insert([
      { first_name: "Raquel", last_name: "Garcia", phone: phone() },
      { first_name: "Miguel", last_name: "Garcia", phone: phone() },
    ])
    .select("id, first_name, phone, pay_token");
  if (error) throw new Error(error.message);
  const mom = parents!.find((p) => p.first_name === "Raquel")!;
  const dad = parents!.find((p) => p.first_name === "Miguel")!;
  const { data: kids } = await admin
    .from("students")
    .insert([
      { first_name: "Mia", last_name: "Garcia" },
      { first_name: "Leo", last_name: "Garcia" },
    ])
    .select("id, first_name");
  const mia = kids!.find((k) => k.first_name === "Mia")!;
  const leo = kids!.find((k) => k.first_name === "Leo")!;
  // Mia's invoice goes to her mother, Leo's to his father.
  await admin.from("student_parents").insert([
    { student_id: mia.id, parent_id: mom.id, relationship: "mother" },
    { student_id: leo.id, parent_id: dad.id, relationship: "father" },
    { student_id: mia.id, parent_id: dad.id, relationship: "father" },
    { student_id: leo.id, parent_id: mom.id, relationship: "mother" },
  ]);
  await admin.from("enrollments").insert([
    { student_id: mia.id, program_id: programId, status: "active" },
    { student_id: leo.id, program_id: programId, status: "active" },
  ]);
  await generateMonthlyInvoices(thisMonth);
  const { data: invoices } = await admin.from("invoices").select("id, student_id");
  const invoiceFor = (studentId: string) => invoices!.find((i) => i.student_id === studentId)!.id as string;
  return { mom, dad, mia, leo, miaInvoice: invoiceFor(mia.id), leoInvoice: invoiceFor(leo.id) };
}

/** Someone else's family, so nothing of theirs turns up on the Garcias' page. */
async function lopez() {
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Ana", last_name: "Lopez", phone: `+1469555${String(++n).padStart(4, "0")}` })
    .select("id, phone")
    .single();
  return p!;
}

describe("a family's page", () => {
  it("adds up what the whole family still owes, less what they've paid", async () => {
    const { mom, dad, miaInvoice } = await garcias();
    await admin.from("payments").insert({ invoice_id: miaInvoice, amount: 40, method: "cash" });

    const family = await getFamily(mom.id);
    expect(family).not.toBeNull();
    // $90 + $90, less $40 paid.
    expect(family!.owedCents).toBe(14000);
    // Either parent's page answers the same question the same way.
    expect((await getFamily(dad.id))!.owedCents).toBe(14000);

    expect(family!.children.map((c) => c.first_name).sort()).toEqual(["Leo", "Mia"]);
    expect(family!.children.every((c) => c.enrollments.length === 1)).toBe(true);
    expect(family!.guardians.map((g) => g.first_name).sort()).toEqual(["Miguel", "Raquel"]);
    expect(family!.parent.pay_token).toBe(mom.pay_token);

    const mia = family!.invoices.find((i) => i.id === miaInvoice)!;
    expect(mia.balanceCents).toBe(5000);
  });

  it("paid and waived invoices owe nothing, and a bank payment on its way is not owed again", async () => {
    const { mom, miaInvoice, leoInvoice } = await garcias();
    await admin.from("payments").insert({ invoice_id: miaInvoice, amount: 90, method: "cash" });
    await admin.from("invoices").update({ status: "paid" }).eq("id", miaInvoice);
    await admin.from("invoices").update({ status: "processing", autopay_status: "processing" }).eq("id", leoInvoice);

    let family = (await getFamily(mom.id))!;
    expect(family.owedCents).toBe(0);
    expect(family.processingCents).toBe(9000);

    await admin.from("invoices").update({ status: "waived", autopay_status: null }).eq("id", leoInvoice);
    family = (await getFamily(mom.id))!;
    expect(family.owedCents).toBe(0);
    expect(family.processingCents).toBe(0);
    expect(family.invoices.every((i) => i.balanceCents === 0)).toBe(true);
  });

  it("shows credit the family has on file", async () => {
    const { mom } = await garcias();
    await admin.from("family_credits").insert({ parent_id: mom.id, amount: 25, method: "cash" });
    expect((await getFamily(mom.id))!.creditCents).toBe(2500);
  });

  it("shows the messages sent to the family, and nobody else's", async () => {
    const { mom, dad } = await garcias();
    const other = await lopez();
    const r: any = await sendBulkMessages(
      [
        // Typed by hand, in another format, it is still Raquel's number.
        { phone: mom.phone.replace("+1", "").replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3"), name: "Raquel Garcia" },
        { phone: dad.phone, name: "Miguel Garcia" },
        { phone: other.phone, name: "Ana Lopez" },
      ],
      "Hi {{parent_name}}, practice is on"
    );
    expect(r.error).toBeUndefined();

    const family = (await getFamily(mom.id))!;
    expect(family.messages.map((m) => m.message).sort()).toEqual([
      "Hi Miguel, practice is on",
      "Hi Raquel, practice is on",
    ]);
  });

  it("is not there for a parent who doesn't exist", async () => {
    expect(await getFamily("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("balances in the lists", () => {
  it("Parents shows what each family owes, and their credit", async () => {
    const { mom, dad, leoInvoice } = await garcias();
    const other = await lopez();
    await admin.from("payments").insert({ invoice_id: leoInvoice, amount: 90, method: "zelle" });
    await admin.from("invoices").update({ status: "paid" }).eq("id", leoInvoice);
    await admin.from("family_credits").insert({ parent_id: dad.id, amount: 10, method: "cash" });

    const balances = await getFamilyBalances();
    expect(balances[mom.id]).toEqual({ owedCents: 9000, creditCents: 0 });
    expect(balances[dad.id]).toEqual({ owedCents: 9000, creditCents: 1000 });
    expect(balances[other.id] ?? { owedCents: 0, creditCents: 0 }).toEqual({ owedCents: 0, creditCents: 0 });
  });

  it("an invoice shows what is left to pay, not the full fee", async () => {
    const { miaInvoice, leoInvoice } = await garcias();
    await admin.from("payments").insert([
      { invoice_id: miaInvoice, amount: 30, method: "cash" },
      { invoice_id: miaInvoice, amount: 15.5, method: "zelle" },
    ]);
    await admin.from("invoices").update({ status: "waived" }).eq("id", leoInvoice);

    const invoices = await getInvoices();
    const mia: any = invoices.find((i: any) => i.id === miaInvoice);
    const leo: any = invoices.find((i: any) => i.id === leoInvoice);
    expect(Number(mia.amount)).toBe(90);
    expect(mia.balance).toBe(44.5);
    expect(leo.balance).toBe(0);
  });
});
