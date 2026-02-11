"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function generateMonthlyInvoices(month?: string) {
  const supabase = createServerSupabase();
  const now = new Date();
  const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dueDate = `${targetMonth}-01`;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, programs(*), students(*, student_parents(parent_id))")
    .eq("status", "active");

  if (!enrollments) return { count: 0 };

  let count = 0;
  for (const enrollment of enrollments) {
    const program = enrollment.programs as any;
    const student = enrollment.students as any;
    const parentLinks = student?.student_parents as any[];

    if (!parentLinks || parentLinks.length === 0) continue;

    for (const link of parentLinks) {
      const { error } = await supabase.from("invoices").insert({
        parent_id: link.parent_id,
        student_id: enrollment.student_id,
        program_id: enrollment.program_id,
        amount: program.monthly_fee,
        month: targetMonth,
        due_date: dueDate,
        status: "pending",
      });

      if (!error) count++;
    }
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { count };
}

export async function recordPayment(formData: FormData) {
  const supabase = createServerSupabase();

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

  // Check if invoice is fully paid
  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("amount")
    .eq("id", invoiceId)
    .single();

  if (payments && invoice) {
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (totalPaid >= Number(invoice.amount)) {
      await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", invoiceId);
    }
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

export async function waiveInvoice(invoiceId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "waived" })
    .eq("id", invoiceId);
  if (error) throw error;
  revalidatePath("/payments");
}
