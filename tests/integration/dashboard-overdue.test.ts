import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { getOverdueSummary } from "@/lib/queries/payments";

/**
 * Issue #14: the dashboard counted overdue invoices from a five-row preview, so
 * with 21 overdue it said 5. The count and the money owed come from every
 * overdue invoice; only the list beside them is cut to five.
 */

afterEach(truncateAll);

async function overdueInvoices(n: number, amount = 100) {
  const { programId } = await seedProgram();
  for (let i = 0; i < n; i++) {
    const { data: p } = await admin
      .from("parents")
      .insert({ first_name: "Parent", last_name: `F${i}`, phone: `+1214556${String(i).padStart(4, "0")}` })
      .select("id")
      .single();
    const { data: s } = await admin.from("students").insert({ first_name: `Kid${i}`, last_name: "Test" }).select("id").single();
    await admin.from("invoices").insert({
      parent_id: p!.id,
      student_id: s!.id,
      program_id: programId,
      amount,
      month: "2026-01",
      due_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      status: "overdue",
    });
  }
}

describe("the dashboard's overdue total", () => {
  it("counts every overdue invoice, not just the five it lists", async () => {
    await overdueInvoices(21, 100);
    const summary = await getOverdueSummary();
    expect(summary.count).toBe(21);
    expect(summary.amount).toBe(2100);
    expect(summary.preview).toHaveLength(5);
    // Oldest first: the families most behind are the ones shown.
    expect(summary.preview[0].due_date).toBe("2026-01-01");
  });

  it("counts what is still owed, like the Payments page", async () => {
    await overdueInvoices(2, 120);
    const { data: inv } = await admin.from("invoices").select("id").order("due_date").limit(1).single();
    await admin.from("payments").insert({ invoice_id: inv!.id, amount: 40, method: "cash" });

    const summary = await getOverdueSummary();
    expect(summary.count).toBe(2);
    expect(summary.amount).toBe(200);
  });

  it("is zero when nothing is overdue", async () => {
    expect(await getOverdueSummary()).toEqual({ count: 0, amount: 0, preview: [] });
  });
});
