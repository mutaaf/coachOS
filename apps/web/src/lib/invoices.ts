/**
 * The month's invoices: one per child per program, idempotent. Not a server
 * action, because the cron runs it on the 1st with no one signed in; the
 * guarded button is generateMonthlyInvoices in lib/actions/payments.ts.
 */
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { addDays, businessMonth, businessToday } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

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
 * Payment Due Day in Settings, as a day every month has. Blank or anything
 * outside 1–28 is the 1st — Settings refuses those, so this is only a guard.
 */
export function readDueDay(value: string | null | undefined): number {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1;
}

export async function paymentDueDay(supabase: OpsClient): Promise<number> {
  const { data } = await supabase.from("config").select("value").eq("key", "payment_due_day").maybeSingle();
  return readDueDay(data?.value);
}

/**
 * The month's due day, or a week after the child joined if that is later. A
 * child enrolled on the 2nd was billed a month that was overdue the day it
 * was made. The joining day is counted in Dallas, not UTC.
 */
export function invoiceDueDate(month: string, enrolledAt: string | Date | null | undefined, dueDay = 1): string {
  const dueOn = `${month}-${String(dueDay).padStart(2, "0")}`;
  if (!enrolledAt) return dueOn;
  const due = addDays(businessToday(new Date(enrolledAt)), JOINING_GRACE_DAYS);
  return due > dueOn ? due : dueOn;
}

/**
 * This month's invoice for a child who has just joined a program, so they are
 * billed from the day they join rather than from the next run on the 1st. The
 * same rules as the monthly run: nothing for a free program or one not yet
 * started, one invoice per child per program, due a week from today or on
 * the month's due day, whichever is later.
 */
export async function billFirstMonth(
  supabase: OpsClient,
  { studentId, programId, parentId }: { studentId: string; programId: string; parentId: string }
): Promise<{ invoiceId: string | null }> {
  const month = businessMonth();
  const { data: program } = await supabase
    .from("programs")
    .select("monthly_fee, status, start_date, end_date, schools(status)")
    .eq("id", programId)
    .single();
  if (!program || !billableMonth(program, (program.schools as any)?.status, month)) return { invoiceId: null };

  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("student_id", studentId)
    .eq("program_id", programId)
    .eq("month", month)
    .limit(1);
  if (existing?.length) return { invoiceId: existing[0].id };

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      parent_id: parentId,
      student_id: studentId,
      program_id: programId,
      amount: program.monthly_fee,
      month,
      due_date: invoiceDueDate(month, new Date(), await paymentDueDay(supabase)),
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;

  // With Stripe on, the family gets the same payment link the monthly run
  // makes — unless autopay charges them, when a link would let them pay twice.
  try {
    const { data: stripeConfig } = await supabase.from("config").select("value").eq("key", "stripe_enabled").maybeSingle();
    if (stripeConfig?.value === "true") {
      const { autopayPayersByStudent } = await import("@/lib/autopay");
      const { createStripeInvoice } = await import("@/lib/stripe-invoices");
      if (!(await autopayPayersByStudent(supabase)).has(studentId)) await createStripeInvoice(invoice.id);
    }
  } catch (err) {
    console.error("Couldn't create the Stripe invoice:", err);
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { invoiceId: invoice.id };
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

  const dueDay = await paymentDueDay(supabase);
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
      due_date: invoiceDueDate(targetMonth, enrollment.enrolled_at, dueDay),
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
