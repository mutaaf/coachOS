/**
 * The month's invoices: one per child per program, idempotent. Not a server
 * action, because the cron runs it on the 1st with no one signed in; the
 * guarded button is generateMonthlyInvoices in lib/actions/payments.ts.
 */
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { addDays, businessMonth, businessToday } from "@/lib/dates";

/** Days a child who joins mid-month has to pay their first invoice. */
export const JOINING_GRACE_DAYS = 7;

/**
 * Whether a program owes anything for the month. A free program never does,
 * nor one that is over, at an archived school, or outside its own dates —
 * each of those used to be billed, and charged by autopay.
 */
export function billableMonth(
  program: { monthly_fee: number | string; status: string; start_date: string | null; end_date: string | null },
  schoolStatus: string | null | undefined,
  month: string
): boolean {
  if (!(Number(program.monthly_fee) > 0)) return false;
  if (program.status === "completed" || program.status === "cancelled") return false;
  if (schoolStatus === "archived") return false;
  if (program.start_date && program.start_date.slice(0, 7) > month) return false;
  if (program.end_date && program.end_date.slice(0, 7) < month) return false;
  return true;
}

/**
 * The 1st of the month, or a week after the child joined if that is later. A
 * child enrolled on the 2nd was billed a month that was overdue the day it
 * was made. The joining day is counted in Dallas, not UTC.
 */
export function invoiceDueDate(month: string, enrolledAt: string | null | undefined): string {
  const first = `${month}-01`;
  if (!enrolledAt) return first;
  const due = addDays(businessToday(new Date(enrolledAt)), JOINING_GRACE_DAYS);
  return due > first ? due : first;
}

export async function createMonthlyInvoices(month?: string) {
  const supabase = createAdminSupabase();
  const targetMonth = month || businessMonth();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, programs(*, schools(status)), students(*, student_parents(parent_id))")
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

    if (!program || !billableMonth(program, program.schools?.status, targetMonth)) continue;

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
      due_date: invoiceDueDate(targetMonth, enrollment.enrolled_at),
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
