import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { normalizePhone, sameName, importRows } from "@/lib/roster";
import { generateMonthlyInvoices, recordPayment, updateInvoice } from "@/lib/actions/payments";
import { getPaymentSummary } from "@/lib/queries/payments";
import { submitRegistration } from "@/lib/actions/registrations";
import { sendBulkMessages, deleteMessageTemplate, updateMessageTemplate } from "@/lib/actions/messages";
import { businessMonth } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Each of these was found by drafting the manual test plan, and each is a way
 * the books or a parent's messages could have gone wrong. Pinned here so they
 * stay fixed.
 */

const db = admin as unknown as OpsClient;
afterEach(truncateAll);

function monthAfter(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function invoice(fee = 100) {
  const { programId } = await seedProgram({ monthlyFee: fee });
  const { data: p } = await admin.from("parents").insert({ first_name: "Sara", last_name: "Yusuf", phone: "+12145550001" }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: "Amina", last_name: "Yusuf" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  await generateMonthlyInvoices(monthAfter(businessMonth()));
  const { data } = await admin.from("invoices").select("id, amount, due_date, month").single();
  return data!;
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("phone numbers with extensions", () => {
  it("drop the extension instead of becoming someone else's number", () => {
    expect(normalizePhone("214-555-0101 x12")).toBe("+12145550101");
    expect(normalizePhone("214-555-0101 ext. 3")).toBe("+12145550101");
  });

  it("refuse a run of digits too long to be a US number, unless written as international", () => {
    expect(normalizePhone("214555010112")).toBeNull();
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
});

describe("names typed with and without accents", () => {
  it("are the same child", async () => {
    expect(sameName("Mía", "mia ")).toBe(true);
    const { programId } = await seedProgram({});
    const row = (child: string) => ({
      child_first_name: child,
      child_last_name: "Test",
      grade: null,
      parent_first_name: "Raquel",
      parent_last_name: "Test",
      parent_phone: "2145550101",
      parent_email: null,
    });
    await importRows(db, programId, [row("Mia")]);
    await importRows(db, programId, [row("Mía")]);
    const { count } = await admin.from("students").select("id", { count: "exact", head: true });
    expect(count).toBe(1);
  });
});

describe("registering the same child twice", () => {
  it("is caught even when the phone is typed differently", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const reg = (phone: string) =>
      submitRegistration(
        form({
          program_id: programId,
          child_first_name: "Ada",
          child_last_name: "Okafor",
          parent_first_name: "Star",
          parent_last_name: "Okafor",
          parent_phone: phone,
        })
      );
    expect(await reg("(214) 555-0150")).toMatchObject({ success: true });
    expect(await reg("2145550150")).toHaveProperty("error", expect.stringMatching(/already have a registration/));
  });
});

describe("recording a payment", () => {
  it("refuses nothing, a negative amount, and more than is owed", async () => {
    const inv = await invoice(100);
    const pay = (amount: string) => recordPayment(form({ invoice_id: inv.id, amount, method: "cash" }));
    expect(await pay("0")).toHaveProperty("error");
    expect(await pay("-10")).toHaveProperty("error");
    expect(await pay("150")).toHaveProperty("error", expect.stringMatching(/more than the \$100\.00 still owed/));
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });
});

describe("editing an invoice", () => {
  it("can't mark it paid without money behind it", async () => {
    const inv = await invoice(100);
    await updateInvoice(inv.id, form({ amount: "100", due_date: inv.due_date, month: inv.month, status: "paid" }));
    const { data } = await admin.from("invoices").select("status").eq("id", inv.id).single();
    expect(data!.status).not.toBe("paid");
  });

  it("recalculates when the amount changes to what has been paid", async () => {
    const inv = await invoice(100);
    await recordPayment(form({ invoice_id: inv.id, amount: "60", method: "cash" }));
    await updateInvoice(inv.id, form({ amount: "60", due_date: inv.due_date, month: inv.month, status: "pending" }));
    const { data } = await admin.from("invoices").select("status").eq("id", inv.id).single();
    expect(data!.status).toBe("paid");
  });
});

describe("the summary cards", () => {
  it("count what is still owed, not the full invoice", async () => {
    const inv = await invoice(100);
    await recordPayment(form({ invoice_id: inv.id, amount: "40", method: "cash" }));
    const summary = await getPaymentSummary();
    expect(summary.pendingAmount).toBe(60);
    expect(summary.totalRevenue).toBe(40);
  });
});

describe("Compose", () => {
  it("fills in each parent's name and never sends a raw placeholder", async () => {
    const ok = await sendBulkMessages(
      [
        { phone: "+12145550101", name: "Raquel Garcia" },
        { phone: "+12145550102", name: "Star Okafor" },
      ],
      "Hi {{parent_name}}, practice moves to 5pm."
    );
    expect(ok).toMatchObject({ count: 2 });
    const { data } = await admin.from("message_queue").select("message").order("recipient_phone");
    expect(data!.map((m) => m.message)).toEqual(["Hi Raquel, practice moves to 5pm.", "Hi Star, practice moves to 5pm."]);

    const refused = await sendBulkMessages([{ phone: "+12145550103", name: "Yoomi Park" }], "Hi {{parent_name}}, {{student_name}} did great");
    expect(refused).toHaveProperty("error", expect.stringMatching(/\{\{student_name\}\}/));
  });
});

describe("templates the app sends on its own", () => {
  it("can be reworded but not renamed or deleted", async () => {
    const { data: t } = await admin.from("message_templates").select("id, body").eq("name", "payment_reminder").single();
    await updateMessageTemplate(t!.id, form({ name: "renamed", category: "payment", body: "Reworded {{parent_name}}" }));
    const { data: after } = await admin.from("message_templates").select("name, body").eq("id", t!.id).single();
    expect(after).toEqual({ name: "payment_reminder", body: "Reworded {{parent_name}}" });

    await expect(deleteMessageTemplate(t!.id)).rejects.toThrow(/can be reworded but not deleted/);
    await admin.from("message_templates").update({ body: t!.body }).eq("id", t!.id);
  });
});
