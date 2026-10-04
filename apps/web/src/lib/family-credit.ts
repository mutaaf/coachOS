import type { OpsClient } from "@/lib/supabase/types";
import { recalculateInvoiceStatus, toCents } from "@/lib/invoice-status";

/**
 * A family's credit: money received that nothing was owed for yet — paid
 * ahead, or more than the invoice. It used to go into a note nobody read.
 * Now it is kept here and the next invoice run spends it (ops.family_credits,
 * ops.apply_family_credit).
 *
 * Not a server action: the cron spends credit with no one signed in.
 */

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function familyCreditCents(supabase: OpsClient, parentId: string): Promise<number> {
  const { data } = await supabase.from("family_credits").select("amount").eq("parent_id", parentId);
  return (data || []).reduce((s, r) => s + toCents(r.amount), 0);
}

/** Every family with credit on file, by parent. */
export async function familyCredits(supabase: OpsClient): Promise<Map<string, number>> {
  const { data } = await supabase.from("family_credits").select("parent_id, amount");
  const byParent = new Map<string, number>();
  for (const r of data || []) byParent.set(r.parent_id, (byParent.get(r.parent_id) ?? 0) + toCents(r.amount));
  for (const [id, cents] of byParent) if (cents <= 0) byParent.delete(id);
  return byParent;
}

/** Keep money as a family's credit. Returns false if this form already did. */
export async function addFamilyCredit(
  supabase: OpsClient,
  credit: {
    parentId: string;
    cents: number;
    method: "cash" | "zelle" | "venmo";
    zelleReceiptId?: string;
    clientKey?: string | null;
    note?: string | null;
  }
): Promise<{ error: string } | { added: boolean }> {
  if (credit.cents <= 0) return { added: false };
  const { error } = await supabase.from("family_credits").insert({
    parent_id: credit.parentId,
    amount: credit.cents / 100,
    method: credit.method,
    zelle_receipt_id: credit.zelleReceiptId ?? null,
    client_key: credit.clientKey || null,
    note: credit.note || null,
  });
  if (error?.code === "23505" && credit.clientKey) return { added: false };
  if (error) return { error: error.message };
  return { added: true };
}

/** Spend a family's credit on what they owe, oldest first. */
export async function applyFamilyCredit(supabase: OpsClient, parentId: string): Promise<number> {
  const { data, error } = await supabase.rpc("apply_family_credit", { p_parent: parentId });
  if (error) throw new Error(error.message);
  const touched = (data as string[] | null) ?? [];
  for (const invoiceId of touched) await recalculateInvoiceStatus(supabase, invoiceId);
  return touched.length;
}

/** After invoices are made: every family with credit spends it. */
export async function applyAllFamilyCredits(supabase: OpsClient): Promise<number> {
  let paid = 0;
  for (const parentId of (await familyCredits(supabase)).keys()) paid += await applyFamilyCredit(supabase, parentId);
  return paid;
}
