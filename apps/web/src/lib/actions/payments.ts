"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { businessMonth } from "@/lib/dates";
import { recalculateInvoiceStatus } from "@/lib/invoice-status";
import { emailReceipt } from "@/lib/parent-emails";
import { revalidatePath } from "next/cache";
import { createMonthlyInvoices } from "@/lib/invoices";

export async function generateMonthlyInvoices(month?: string) {
  await requireSignedIn();
  return createMonthlyInvoices(month);
}

export async function recordPayment(formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const invoiceId = formData.get("invoice_id") as string;
  const amount = Number(formData.get("amount"));
  const method = formData.get("method") as string;
  const reference = formData.get("reference") as string;
  const notes = formData.get("notes") as string;
  // Made when the dialog opened: the same form sent twice (a double tap, a
  // retry) is one payment, not two.
  const clientKey = (formData.get("client_key") as string) || null;

  // The books only take money that is real and owed: nothing zero or
  // negative, and nothing beyond the invoice's balance, which would count
  // revenue twice or hide an overpayment that should go back.
  if (!(amount > 0)) return { error: "Enter an amount greater than $0." };
  if (clientKey && (await alreadyRecorded(supabase, clientKey))) return { success: true };
  const { data: inv } = await supabase
    .from("invoices")
    .select("amount, status, payments(amount)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "That invoice no longer exists." };
  if (inv.status === "waived") return { error: "That invoice was waived; nothing is owed on it." };
  const balanceCents =
    Math.round(Number(inv.amount) * 100) -
    (inv.payments || []).reduce((s: number, p: any) => s + Math.round(Number(p.amount) * 100), 0);
  if (Math.round(amount * 100) > balanceCents) {
    return {
      error: `That's more than the $${(balanceCents / 100).toFixed(2)} still owed. If they paid extra, use Record Payment at the top of Payments — the rest is kept as their credit.`,
    };
  }

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      amount,
      method,
      reference: reference || null,
      notes: notes || null,
      client_key: clientKey,
    })
    .select("id")
    .single();

  // 23505 on the key: the same form, sent at the same moment, already saved it.
  if (error?.code === "23505" && clientKey) return { success: true };
  if (error) throw error;

  await recalculateInvoiceStatus(supabase, invoiceId);
  await emailReceipt(supabase, { paymentIds: [payment.id], parentId: null, dedupeKey: `receipt:${payment.id}` });

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { success: true };
}

async function alreadyRecorded(supabase: ReturnType<typeof createAdminSupabase>, clientKey: string) {
  const { data } = await supabase.from("payments").select("id").eq("client_key", clientKey).limit(1);
  return (data?.length ?? 0) > 0;
}

export async function fetchPendingInvoices() {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*)")
    .in("status", ["pending", "overdue"])
    .order("due_date");
  if (error) throw error;
  return data || [];
}

export async function fetchInvoiceDetail(id: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*), payments(amount)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function waiveInvoice(invoiceId: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "waived" })
    .eq("id", invoiceId);
  if (error) throw error;
  revalidatePath("/payments");
}

export async function updateInvoice(id: string, formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const amount = Number(formData.get("amount"));
  const due_date = formData.get("due_date") as string;
  const month = formData.get("month") as string;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string;

  if (!amount || !due_date || !month || !status) {
    return { error: "Amount, due date, month, and status are required" };
  }

  // Paid, pending and overdue are worked out from the money, never typed in:
  // marking an invoice paid by hand would show money received that wasn't.
  // Waiving is the one status that is a decision, so it is the one honoured.
  const { data, error } = await supabase
    .from("invoices")
    .update({ amount, due_date, month, status: status === "waived" ? "waived" : "pending", notes: notes || null })
    .eq("id", id)
    .select()
    .single();

  if (error) return { error: error.message };
  await recalculateInvoiceStatus(supabase, id);

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { data };
}

export async function deleteInvoice(id: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: existingPayments } = await supabase
    .from("payments")
    .select("id")
    .eq("invoice_id", id)
    .limit(1);

  if (existingPayments && existingPayments.length > 0) {
    return { error: "Delete the payments first before deleting this invoice" };
  }

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updatePayment(id: string, formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();

  const amount = Number(formData.get("amount"));
  const method = formData.get("method") as string;
  const reference = formData.get("reference") as string;
  const notes = formData.get("notes") as string;

  if (!method) return { error: "Pick how it was paid." };

  // The same rules as recording it: more than $0, and no more than the
  // invoice leaves room for once its other payments are counted. An edit to
  // $500 used to raise revenue by money never received.
  if (!(amount > 0)) return { error: "Enter an amount greater than $0." };
  const { data: current } = await supabase
    .from("payments")
    .select("invoice_id, invoices(amount, payments(id, amount))")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "That payment no longer exists." };
  const inv = current.invoices as unknown as { amount: number; payments: { id: string; amount: number }[] } | null;
  if (inv) {
    const roomCents =
      Math.round(Number(inv.amount) * 100) -
      (inv.payments || [])
        .filter((p) => p.id !== id)
        .reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
    if (Math.round(amount * 100) > roomCents) {
      return {
        error: `That's more than the $${(Math.max(roomCents, 0) / 100).toFixed(2)} this invoice leaves for this payment. Change the invoice first if the amount owed was wrong.`,
      };
    }
  }

  const { data, error } = await supabase
    .from("payments")
    .update({ amount, method, reference: reference || null, notes: notes || null })
    .eq("id", id)
    .select("invoice_id")
    .single();

  if (error) return { error: error.message };

  await recalculateInvoiceStatus(supabase, data.invoice_id);

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { data };
}

export async function deletePayment(id: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: payment } = await supabase
    .from("payments")
    .select("invoice_id")
    .eq("id", id)
    .single();

  if (!payment) return { error: "Payment not found" };

  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) return { error: error.message };

  await recalculateInvoiceStatus(supabase, payment.invoice_id);

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { success: true };
}
