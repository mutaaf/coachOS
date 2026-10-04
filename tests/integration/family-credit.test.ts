import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices, deletePayment } from "@/lib/actions/payments";
import { matchZelleReceipt, undoZelleMatch } from "@/lib/actions/zelle";
import { assignUnrecognisedPayment } from "@/lib/actions/payment-assign";
import { getPayPage } from "@/lib/queries/pay-page";
import { getPaymentSummary } from "@/lib/queries/payments";
import { familyCreditCents } from "@/lib/family-credit";
import { ingestZelleEmail } from "@/lib/zelle";
import { businessMonth } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Issue #28: money with nowhere to go. Extra on a payment went into a note
 * nobody reads, and a paid-up family's Zelle couldn't be recorded at all — so
 * the cash in her hand didn't match the books. Now it is the family's credit,
 * and the next invoice run spends it.
 */

const db = admin as unknown as OpsClient;

afterEach(truncateAll);

function monthAfter(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
const thisMonth = businessMonth();
const nextMonth = monthAfter(thisMonth);

let n = 0;
/** A parent with one child on a $90/month program, and this month's invoice. */
async function family(last = "Garcia") {
  const { programId } = await seedProgram({ monthlyFee: 90 });
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: last, phone: `+1214555${String(++n).padStart(4, "0")}` })
    .select("id, pay_token")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: "Mia", last_name: last }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  await generateMonthlyInvoices(thisMonth);
  return { parentId: p!.id as string, payToken: p!.pay_token as string };
}

async function invoices(parentId: string) {
  const { data } = await admin
    .from("invoices")
    .select("id, month, status, payments(id, amount, method)")
    .eq("parent_id", parentId)
    .order("month");
  return data!;
}

async function payInFull(parentId: string) {
  const [inv] = await invoices(parentId);
  await admin.from("payments").insert({ invoice_id: inv.id, amount: 90, method: "cash" });
  await admin.from("invoices").update({ status: "paid" }).eq("id", inv.id);
}

let msg = 0;
const zelleEmail = (subject: string) => ({ messageId: `credit-${Date.now()}-${++msg}`, subject, text: "" });

describe("more than was owed", () => {
  it("keeps the extra as credit, and next month's invoice is paid from it", async () => {
    const { parentId } = await family();
    const result: any = await assignUnrecognisedPayment({
      source: { kind: "manual", amount: 140, method: "cash" },
      parent: { id: parentId },
    });
    expect(result.error).toBeUndefined();
    expect(result.leftoverCents).toBe(5000);
    expect(await familyCreditCents(db, parentId)).toBe(5000);

    await generateMonthlyInvoices(nextMonth);

    const [now, next] = await invoices(parentId);
    expect(now.status).toBe("paid");
    expect(next.payments).toEqual([expect.objectContaining({ amount: 50, method: "credit" })]);
    expect(next.status).not.toBe("paid");
    expect(await familyCreditCents(db, parentId)).toBe(0);
  });

  it("from a Zelle the owner matched, the extra is credit too", async () => {
    const { parentId } = await family();
    const r = await ingestZelleEmail(db, zelleEmail("Miguel Garcia sent you $120.00"));
    const matched: any = await matchZelleReceipt((r as any).receiptId, parentId);
    expect(matched).toMatchObject({ success: true });
    expect(await familyCreditCents(db, parentId)).toBe(3000);
    const { data: receipt } = await admin.from("zelle_receipts").select("note").eq("id", (r as any).receiptId).single();
    expect(receipt!.note).toMatch(/\$30\.00 more than was owed — kept as credit/);
  });
});

describe("a family who has already paid", () => {
  it("can still have a Zelle recorded: it all becomes credit, and pays next month in full", async () => {
    const { parentId } = await family();
    await payInFull(parentId);

    const r = await ingestZelleEmail(db, zelleEmail("Raquel Garcia sent you $90.00"));
    expect(r.outcome).toBe("unmatched");
    const matched: any = await matchZelleReceipt((r as any).receiptId, parentId);
    expect(matched.error).toBeUndefined();
    expect(await familyCreditCents(db, parentId)).toBe(9000);
    const { data: receipt } = await admin.from("zelle_receipts").select("status").eq("id", (r as any).receiptId).single();
    expect(receipt!.status).toBe("matched");

    await generateMonthlyInvoices(nextMonth);
    const [, next] = await invoices(parentId);
    expect(next.status).toBe("paid");
    expect(await familyCreditCents(db, parentId)).toBe(0);
  });

  it("can have cash recorded in advance from Who paid this?, with nothing else to fill in", async () => {
    const { parentId } = await family();
    await payInFull(parentId);
    const result: any = await assignUnrecognisedPayment({
      source: { kind: "manual", amount: 90, method: "cash" },
      parent: { id: parentId },
    });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ appliedCents: 0, leftoverCents: 9000 });
    expect(await familyCreditCents(db, parentId)).toBe(9000);
  });

  it("the same form sent twice is credited once", async () => {
    const { parentId } = await family();
    await payInFull(parentId);
    const input = { source: { kind: "manual" as const, amount: 90, method: "cash" as const }, parent: { id: parentId }, key: "credit-key-1" };
    await assignUnrecognisedPayment(input);
    const again: any = await assignUnrecognisedPayment(input);
    expect(again.error).toBeUndefined();
    expect(await familyCreditCents(db, parentId)).toBe(9000);
  });

  it("the pay page shows the credit and doesn't ask them to send anything", async () => {
    const { parentId, payToken } = await family();
    await payInFull(parentId);
    await assignUnrecognisedPayment({ source: { kind: "manual", amount: 90, method: "cash" }, parent: { id: parentId } });

    const page = await getPayPage(payToken);
    expect(page!.openCents).toBe(0);
    expect(page!.creditCents).toBe(9000);
  });
});

describe("taking it back", () => {
  it("undoing a Zelle match takes its credit away too", async () => {
    const { parentId } = await family();
    await payInFull(parentId);
    const r = await ingestZelleEmail(db, zelleEmail("Raquel Garcia sent you $90.00"));
    await matchZelleReceipt((r as any).receiptId, parentId);

    const undone: any = await undoZelleMatch((r as any).receiptId);
    expect(undone).toMatchObject({ success: true });
    expect(await familyCreditCents(db, parentId)).toBe(0);
  });

  it("won't undo a Zelle match whose credit has already paid an invoice", async () => {
    const { parentId } = await family();
    await payInFull(parentId);
    const r = await ingestZelleEmail(db, zelleEmail("Raquel Garcia sent you $90.00"));
    await matchZelleReceipt((r as any).receiptId, parentId);
    await generateMonthlyInvoices(nextMonth);

    const undone: any = await undoZelleMatch((r as any).receiptId);
    expect(undone.error).toMatch(/already gone toward/);
    expect(await familyCreditCents(db, parentId)).toBe(0);
    const [, next] = await invoices(parentId);
    expect(next.status).toBe("paid");
  });

  it("deleting a payment made from credit puts the credit back", async () => {
    const { parentId } = await family();
    await payInFull(parentId);
    await assignUnrecognisedPayment({ source: { kind: "manual", amount: 90, method: "cash" }, parent: { id: parentId } });
    await generateMonthlyInvoices(nextMonth);
    const [, next] = await invoices(parentId);

    await deletePayment(next.payments[0].id);
    expect(await familyCreditCents(db, parentId)).toBe(9000);
  });
});

describe("the books", () => {
  it("count money kept as credit once: when it came in, not again when it is spent", async () => {
    const { parentId } = await family();
    await assignUnrecognisedPayment({ source: { kind: "manual", amount: 140, method: "cash" }, parent: { id: parentId } });
    expect((await getPaymentSummary()).totalRevenue).toBe(140);

    await generateMonthlyInvoices(nextMonth);
    expect((await getPaymentSummary()).totalRevenue).toBe(140);
  });
});
