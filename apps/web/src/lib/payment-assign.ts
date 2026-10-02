import type { OpsClient } from "@/lib/supabase/types";
import { businessMonth } from "@/lib/dates";
import { normalizePhone, phoneKey, sameName } from "@/lib/roster";
import { openInvoicesForFamily, recalculateInvoiceStatus, toCents } from "@/lib/invoice-status";
import { allocateGreedily, applyReceipt, senderKey } from "@/lib/zelle";
import { emailReceipt } from "@/lib/parent-emails";

/**
 * A payment from someone CoachOS doesn't recognise, put where it belongs.
 *
 * The owner says who paid. That may be a family already on file, or someone
 * new — and someone new may have a child, a school or a program not set up
 * yet. Whatever is missing is created in one transaction (ops.place_family),
 * this month's invoice with it, and then the money is recorded against what
 * the family owes, oldest first.
 *
 * Not a server action: the guarded entry point is lib/actions/payment-assign.ts.
 */

export type PaymentSource =
  | { kind: "zelle"; receiptId: string }
  | { kind: "manual"; amount: number; method: "cash" | "zelle" | "venmo"; receivedAt?: string; note?: string };

export type ParentChoice =
  | { id: string }
  | { first_name: string; last_name?: string; phone: string; email?: string };

export interface Placement {
  student: { id: string } | { first_name: string; last_name?: string; grade?: string };
  school?: { id: string } | { name: string };
  program: { id: string } | { name: string; monthly_fee: number };
}

export interface AssignInput {
  source: PaymentSource;
  parent: ParentChoice;
  /** Required when the family has nothing open to pay. */
  placement?: Placement;
}

export interface AssignResult {
  success: true;
  parentId: string;
  /** What had to be made: "school", "program", "parent", "student", "invoice". */
  created: string[];
  /** A "new" parent whose phone was already on file: that family was used. */
  reusedParent: string | null;
  appliedCents: number;
  leftoverCents: number;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function assignPayment(
  supabase: OpsClient,
  input: AssignInput,
  month: string = businessMonth()
): Promise<{ error: string } | AssignResult> {
  // The money --------------------------------------------------------------
  let cents: number;
  let receipt: { id: string; sender_name: string | null; received_at: string; memo: string | null } | null = null;
  if (input.source.kind === "zelle") {
    const { data } = await supabase
      .from("zelle_receipts")
      .select("id, sender_name, amount, memo, received_at, status")
      .eq("id", input.source.receiptId)
      .maybeSingle();
    if (!data) return { error: "That payment is no longer in the inbox." };
    if (data.status === "matched") return { error: "That payment has already been recorded." };
    if (data.amount == null || !data.sender_name) {
      return { error: "This email couldn't be read. Record the payment by hand instead." };
    }
    receipt = data;
    cents = toCents(data.amount);
  } else {
    cents = Math.round(Number(input.source.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return { error: "Enter the amount that was paid." };
    if (!["cash", "zelle", "venmo"].includes(input.source.method)) return { error: "Pick how it was paid." };
  }

  // Who --------------------------------------------------------------------
  let parentId: string | null = "id" in input.parent ? s(input.parent.id) || null : null;
  let reusedParent: string | null = null;
  let newParent: Record<string, string | null> | null = null;
  if (!parentId) {
    const p = input.parent as Exclude<ParentChoice, { id: string }>;
    if (!s(p.first_name)) return { error: "Enter the parent's first name." };
    const phone = normalizePhone(p.phone);
    if (!phone) return { error: "Enter the parent's phone number — it's how WhatsApp messages reach them." };
    // The same phone is the same family, however the name was typed.
    const { data: all } = await supabase.from("parents").select("id, first_name, last_name, phone");
    const same = (all || []).find((x) => phoneKey(x.phone) === phoneKey(phone));
    if (same) {
      parentId = same.id;
      reusedParent = `${same.first_name} ${same.last_name}`.trim();
    } else {
      newParent = {
        first_name: s(p.first_name),
        last_name: s(p.last_name) || null,
        phone,
        email: s(p.email) || null,
        preferred_payment: input.source.kind === "manual" ? input.source.method : "zelle",
        zelle_identifier: receipt?.sender_name ?? null,
      };
    }
  }

  // Where ------------------------------------------------------------------
  let created: string[] = [];
  if (input.placement) {
    const pl = input.placement;
    let student: Record<string, unknown> = { ...pl.student };
    // A "new" child who is already this family's is the same child.
    if (!("id" in pl.student) && parentId) {
      const { data: kids } = await supabase
        .from("student_parents")
        .select("students(id, first_name)")
        .eq("parent_id", parentId);
      const match = (kids || []).map((k: any) => k.students).find((k: any) => k && sameName(k.first_name, (pl.student as any).first_name));
      if (match) student = { id: match.id };
    }
    if (!("id" in student) && !s(student.first_name)) return { error: "Enter the child's first name." };
    if ("monthly_fee" in pl.program && !(Number(pl.program.monthly_fee) > 0)) {
      return { error: "Enter the new program's monthly fee." };
    }

    const { data, error } = await supabase.rpc("place_family", {
      p: {
        month,
        parent: parentId ? { id: parentId } : newParent,
        student,
        school: pl.school ?? null,
        program: pl.program,
      },
    });
    if (error) return { error: error.message };
    parentId = (data as any).parent_id;
    created = (data as any).created ?? [];
  } else if (!parentId) {
    return { error: "Say which child this is for, and their program." };
  }

  // The payment ------------------------------------------------------------
  const open = await openInvoicesForFamily(supabase, parentId!);
  if (open.length === 0) {
    return { error: "This family has nothing to pay. Add the child and program it's for." };
  }
  const { picked, leftoverCents } = allocateGreedily(open, cents);
  const note = leftoverCents > 0 ? `$${(leftoverCents / 100).toFixed(2)} more than was owed — not applied to anything.` : null;

  if (receipt) {
    const applied = await applyReceipt(supabase, receipt, parentId!, picked, note);
    if ("error" in applied) return { error: applied.error! };
    // Their next payment matches by itself.
    await supabase
      .from("zelle_senders")
      .upsert({ sender_key: senderKey(receipt.sender_name!), parent_id: parentId }, { onConflict: "sender_key" });
  } else {
    const src = input.source as Extract<PaymentSource, { kind: "manual" }>;
    const paymentIds: string[] = [];
    for (const { invoice, cents: c } of picked) {
      const { data, error } = await supabase
        .from("payments")
        .insert({
          invoice_id: invoice.id,
          amount: c / 100,
          method: src.method,
          received_at: src.receivedAt || new Date().toISOString(),
          notes: [s(src.note), note].filter(Boolean).join(" ") || null,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      paymentIds.push(data.id);
      await recalculateInvoiceStatus(supabase, invoice.id);
    }
    await emailReceipt(supabase, {
      paymentIds,
      parentId,
      method: src.method[0].toUpperCase() + src.method.slice(1),
      dedupeKey: `receipt:${paymentIds[0]}`,
    });
  }

  return {
    success: true,
    parentId: parentId!,
    created,
    reusedParent,
    appliedCents: cents - leftoverCents,
    leftoverCents,
  };
}
