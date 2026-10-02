/**
 * The month's invoices: one per child per program, idempotent. Not a server
 * action, because the cron runs it on the 1st with no one signed in; the
 * guarded button is generateMonthlyInvoices in lib/actions/payments.ts.
 */
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { businessMonth } from "@/lib/dates";

export async function createMonthlyInvoices(month?: string) {
  const supabase = createAdminSupabase();
  const targetMonth = month || businessMonth();
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

  // Keyed by child and program, deliberately not by parent: one child on one
  // program owes one fee, whoever pays it.
  const existingKeys = new Set(
    (existingInvoices || []).map((inv) => `${inv.student_id}|${inv.program_id}`)
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

    const key = `${enrollment.student_id}|${enrollment.program_id}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    // Bill a single parent. Iterating every link used to create one invoice
    // per parent, so a family with both parents on file was charged twice for
    // the same child. Sorted so repeat runs always pick the same one.
    const billTo = [...parentLinks].sort((a, b) =>
      String(a.parent_id).localeCompare(String(b.parent_id))
    )[0];

    const { error } = await supabase.from("invoices").insert({
      parent_id: billTo.parent_id,
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

  // If Stripe is enabled, create Stripe invoices for the new batch
  const { data: stripeConfig } = await supabase
    .from("config")
    .select("value")
    .eq("key", "stripe_enabled")
    .single();

  if (stripeConfig?.value === "true" && created > 0) {
    const { createStripeInvoicesForMonth } = await import("@/lib/stripe-invoices");
    await createStripeInvoicesForMonth(targetMonth);
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { created, skipped, noParent, total: created + skipped };
}
