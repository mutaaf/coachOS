"use server";

import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { openInvoicesForFamily, recalculateInvoiceStatus, toCents } from "@/lib/invoice-status";
import { familyCreditCents } from "@/lib/family-credit";
import { allocateGreedily, applyReceipt, rememberableKey, senderKey } from "@/lib/zelle";

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
  if (!(await signedIn())) return NOT_SIGNED_IN;
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

  // Whatever isn't owed yet — all of it, for a family who has paid — is kept
  // as their credit and spent by the next invoice run.
  const open = await openInvoicesForFamily(supabase, parentId);
  const { picked, leftoverCents } = allocateGreedily(open, Math.round(Number(receipt.amount) * 100));

  const applied = await applyReceipt(supabase, receipt, parentId, picked, leftoverCents);
  if ("error" in applied) return applied;

  const key = rememberableKey(receipt.sender_name);
  if (key) {
    await supabase
      .from("zelle_senders")
      .upsert({ sender_key: key, parent_id: parentId }, { onConflict: "sender_key" });
  }

  refresh();
  return { success: true, credit: leftoverCents / 100 };
}

/** Not a family paying — a refund, a friend, something unrelated. */
export async function ignoreZelleReceipt(receiptId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: receipt } = await supabase
    .from("zelle_receipts")
    .select("id, sender_name, parent_id, status")
    .eq("id", receiptId)
    .maybeSingle();
  if (!receipt || receipt.status !== "matched") return { error: "That payment isn't matched." };

  // What it left as credit comes off too — unless the family has spent it.
  const { data: credit } = await supabase
    .from("family_credits")
    .select("id, parent_id, amount")
    .eq("zelle_receipt_id", receiptId)
    .maybeSingle();
  if (credit) {
    if ((await familyCreditCents(supabase, credit.parent_id)) < toCents(credit.amount)) {
      return {
        error:
          "Some of this payment has already gone toward a later invoice as credit. Delete that credit payment from Payment History first, then undo this.",
      };
    }
    const { error } = await supabase.from("family_credits").delete().eq("id", credit.id);
    if (error) return { error: error.message };
  }

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
