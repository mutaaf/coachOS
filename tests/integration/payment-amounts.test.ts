import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices, recordPayment, updatePayment } from "@/lib/actions/payments";
import { assignUnrecognisedPayment } from "@/lib/actions/payment-assign";
import { businessMonth } from "@/lib/dates";

/**
 * The amount a family paid is the number the Boss reconciles. Issue #9 found
 * three ways it could be wrong without anyone noticing: an edit to any amount
 * at all, and a double tap recording the same money twice.
 */

afterEach(truncateAll);

function monthAfter(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function family(fee = 120) {
  const { programId } = await seedProgram({ monthlyFee: fee });
  const { data: p } = await admin.from("parents").insert({ first_name: "Sara", last_name: "Yusuf", phone: "+12145550001" }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: "Theo", last_name: "Yusuf" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  await generateMonthlyInvoices(monthAfter(businessMonth()));
  const { data } = await admin.from("invoices").select("id, amount").single();
  return { invoice: data!, parentId: p!.id as string };
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

async function payments() {
  const { data } = await admin.from("payments").select("id, amount").order("created_at");
  return data!;
}

describe("editing a payment", () => {
  it("refuses nothing, a negative amount, and more than the invoice leaves room for", async () => {
    const { invoice } = await family(120);
    await recordPayment(form({ invoice_id: invoice.id, amount: "40", method: "cash" }));
    await recordPayment(form({ invoice_id: invoice.id, amount: "20", method: "cash" }));
    const [first] = await payments();
    const edit = (amount: string) => updatePayment(first.id, form({ amount, method: "cash" }));

    expect(await edit("0")).toHaveProperty("error");
    expect(await edit("-50")).toHaveProperty("error");
    // $120 owed, $20 paid by the other payment: this one can be at most $100.
    expect(await edit("500")).toHaveProperty("error", expect.stringMatching(/\$100\.00/));
    expect(await edit("100.01")).toHaveProperty("error");
    expect((await payments()).map((p) => p.amount)).toEqual([40, 20]);

    expect(await edit("100")).not.toHaveProperty("error");
    expect((await payments()).map((p) => p.amount)).toEqual([100, 20]);
    const { data } = await admin.from("invoices").select("status").eq("id", invoice.id).single();
    expect(data!.status).toBe("paid");
  });
});

describe("recording the same payment twice", () => {
  it("Record Payment saves it once, however many times the same form arrives", async () => {
    const { invoice } = await family(120);
    const send = () => recordPayment(form({ invoice_id: invoice.id, amount: "40", method: "cash", client_key: "tap-1" }));
    const results = await Promise.all([send(), send()]);
    for (const r of results) expect(r ?? {}).not.toHaveProperty("error");
    expect(await send()).not.toHaveProperty("error");
    expect((await payments()).map((p) => p.amount)).toEqual([40]);

    // A different payment of the same amount is still its own payment.
    await recordPayment(form({ invoice_id: invoice.id, amount: "40", method: "cash", client_key: "tap-2" }));
    expect((await payments()).map((p) => p.amount)).toEqual([40, 40]);
  });

  it("Who paid this? saves it once too", async () => {
    const { parentId } = await family(120);
    const send = () =>
      assignUnrecognisedPayment({ source: { kind: "manual", amount: 40, method: "cash" }, parent: { id: parentId }, key: "tap-1" });
    const results = await Promise.all([send(), send()]);
    for (const r of results) expect(r).not.toHaveProperty("error");
    expect((await payments()).map((p) => p.amount)).toEqual([40]);
  });
});
