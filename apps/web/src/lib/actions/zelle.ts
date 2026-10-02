"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { openInvoicesForFamily, recalculateInvoiceStatus } from "@/lib/invoice-status";
import { allocateGreedily, applyReceipt, senderKey } from "@/lib/zelle";

function refresh() {
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

/**
 * The owner says who sent a Zelle payment. The money goes on that family's
 * oldest open invoices, and the sender's name is remembered so their next
 * payment matches by itself.
 */
export async function matchZelleReceipt(receiptId: string, parentId: string) {
  if (!receiptId || !parentId) return { error: "Pick the family this came from." };
  const supabase = createAdminSupabase();

  const { data: receipt } = await supabase
    .from("zelle_receipts")
    .select("id, sender_name, amount, memo, received_at, status")
    .eq("id", receiptId)
    .maybeSingle();

  if (!receipt) return { error: "That payment is no longer in the inbox." };
  if (receipt.status === "matched") return { error: "That payment has already been recorded." };
  if (receipt.amount == null || !receipt.sender_name) {
    return { error: "This email couldn't be read. Record the payment by hand instead." };
  }

  const open = await openInvoicesForFamily(supabase, parentId);
  if (open.length === 0) {
    return { error: "That family has nothing open to pay. Generate this month's invoices first, or ignore this one." };
  }

  const { picked, leftoverCents } = allocateGreedily(open, Math.round(Number(receipt.amount) * 100));
  const note =
    leftoverCents > 0
      ? `$${(leftoverCents / 100).toFixed(2)} more than was owed — not applied to anything.`
      : null;

  const applied = await applyReceipt(supabase, receipt, parentId, picked, note);
  if ("error" in applied) return applied;

  await supabase
    .from("zelle_senders")
    .upsert(
      { sender_key: senderKey(receipt.sender_name), parent_id: parentId },
      { onConflict: "sender_key" }
    );

  refresh();
  return { success: true, leftover: leftoverCents / 100 };
}

/** Not a family paying — a refund, a friend, something unrelated. */
export async function ignoreZelleReceipt(receiptId: string) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("zelle_receipts")
    .update({ status: "ignored" })
    .eq("id", receiptId)
    .neq("status", "matched");
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

/**
 * Take back a match that was wrong. The payments come off the invoices, and the
 * name is forgotten so the same mistake does not repeat next month.
 */
export async function undoZelleMatch(receiptId: string) {
  const supabase = createAdminSupabase();

  const { data: receipt } = await supabase
    .from("zelle_receipts")
    .select("id, sender_name, parent_id, status")
    .eq("id", receiptId)
    .maybeSingle();
  if (!receipt || receipt.status !== "matched") return { error: "That payment isn't matched." };

  const { data: payments } = await supabase
    .from("payments")
    .select("id, invoice_id")
    .eq("zelle_receipt_id", receiptId);

  const { error } = await supabase.from("payments").delete().eq("zelle_receipt_id", receiptId);
  if (error) return { error: error.message };

  for (const invoiceId of new Set((payments || []).map((p) => p.invoice_id))) {
    await recalculateInvoiceStatus(supabase, invoiceId);
  }

  if (receipt.sender_name && receipt.parent_id) {
    await supabase
      .from("zelle_senders")
      .delete()
      .eq("sender_key", senderKey(receipt.sender_name))
      .eq("parent_id", receipt.parent_id);
  }

  await supabase
    .from("zelle_receipts")
    .update({ status: "unmatched", parent_id: null, note: "Match undone — pick the right family." })
    .eq("id", receiptId);

  refresh();
  return { success: true };
}
