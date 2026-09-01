"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function generateMonthlyInvoices(month?: string) {
  const supabase = createAdminSupabase();
  const now = new Date();
  const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dueDate = `${targetMonth}-01`;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, programs(*), students(*, student_parents(parent_id))")
    .eq("status", "active");

  if (!enrollments) return { created: 0, skipped: 0, total: 0 };

  // Query existing invoices for the target month to enable idempotency
  const { data: existingInvoices } = await supabase
    .from("invoices")
    .select("parent_id, student_id, program_id")
    .eq("month", targetMonth);

  const existingKeys = new Set(
    (existingInvoices || []).map(
      (inv) => `${inv.parent_id}|${inv.student_id}|${inv.program_id}`
    )
  );

  let created = 0;
  let skipped = 0;
  let noParent = 0;

  for (const enrollment of enrollments) {
    const program = enrollment.programs as any;
    const student = enrollment.students as any;
    const parentLinks = student?.student_parents as any[];

    if (!parentLinks || parentLinks.length === 0) {
      noParent++;
      continue;
    }

    for (const link of parentLinks) {
      const key = `${link.parent_id}|${enrollment.student_id}|${enrollment.program_id}`;

      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from("invoices").insert({
        parent_id: link.parent_id,
        student_id: enrollment.student_id,
        program_id: enrollment.program_id,
        amount: program.monthly_fee,
        month: targetMonth,
        due_date: dueDate,
        status: "pending",
      });

      if (!error) {
        created++;
        existingKeys.add(key);
      }
    }
  }

  // If Stripe is enabled, create Stripe invoices for the new batch
  const { data: stripeConfig } = await supabase
    .from("config")
    .select("value")
    .eq("key", "stripe_enabled")
    .single();

  if (stripeConfig?.value === "true" && created > 0) {
    const { createStripeInvoicesForMonth } = await import("@/lib/actions/stripe");
    await createStripeInvoicesForMonth(targetMonth);
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { created, skipped, noParent, total: created + skipped };
}

export async function recordPayment(formData: FormData) {
  const supabase = createAdminSupabase();

  const invoiceId = formData.get("invoice_id") as string;
  const amount = Number(formData.get("amount"));
  const method = formData.get("method") as string;
  const reference = formData.get("reference") as string;
  const notes = formData.get("notes") as string;

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    method,
    reference: reference || null,
    notes: notes || null,
  });

  if (error) throw error;

  await recalculateInvoiceStatus(supabase, invoiceId);

  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

export async function fetchPendingInvoices() {
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
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*), payments(amount)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function recalculateInvoiceStatus(supabase: any, invoiceId: string) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("amount, status, due_date")
    .eq("id", invoiceId)
    .single();

  if (!invoice || invoice.status === "waived") return;

  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  const totalPaid = (payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  let newStatus: string;
  if (totalPaid >= Number(invoice.amount)) {
    newStatus = "paid";
  } else if (new Date(invoice.due_date) < new Date()) {
    newStatus = "overdue";
  } else {
    newStatus = "pending";
  }

  if (newStatus !== invoice.status) {
    await supabase.from("invoices").update({ status: newStatus }).eq("id", invoiceId);
  }
}

export async function waiveInvoice(invoiceId: string) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "waived" })
    .eq("id", invoiceId);
  if (error) throw error;
  revalidatePath("/payments");
}

export async function updateInvoice(id: string, formData: FormData) {
  const supabase = createAdminSupabase();

  const amount = Number(formData.get("amount"));
  const due_date = formData.get("due_date") as string;
  const month = formData.get("month") as string;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string;

  if (!amount || !due_date || !month || !status) {
    return { error: "Amount, due date, month, and status are required" };
  }

  const { data, error } = await supabase
    .from("invoices")
    .update({ amount, due_date, month, status, notes: notes || null })
    .eq("id", id)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { data };
}

export async function deleteInvoice(id: string) {
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
  const supabase = createAdminSupabase();

  const amount = Number(formData.get("amount"));
  const method = formData.get("method") as string;
  const reference = formData.get("reference") as string;
  const notes = formData.get("notes") as string;

  if (!amount || !method) {
    return { error: "Amount and method are required" };
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
