import type { OpsClient } from "@/lib/supabase/types";
import { isPastDue } from "@/lib/dates";

/** Money as whole cents, so sums of payments compare exactly. */
export function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/**
 * Set an invoice's status from what has actually been paid against it.
 *
 * Every path that adds or removes money — a payment recorded by hand, an
 * autopay charge settling, a Zelle email matched — ends here, so the rules live
 * in one place:
 *   * waived stays waived
 *   * paid in full is paid
 *   * a bank debit still settling is processing, not overdue
 *   * otherwise pending until the due date has passed, then overdue
 */
export async function recalculateInvoiceStatus(supabase: OpsClient, invoiceId: string) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("amount, status, due_date, autopay_status")
    .eq("id", invoiceId)
    .single();

  if (!invoice || invoice.status === "waived") return;

  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  const paidCents = (payments || []).reduce((sum, p) => sum + toCents(p.amount), 0);

  let newStatus: string;
  if (paidCents >= toCents(invoice.amount)) {
    newStatus = "paid";
  } else if (invoice.autopay_status === "processing") {
    newStatus = "processing";
  } else if (isPastDue(invoice.due_date)) {
    newStatus = "overdue";
  } else {
    newStatus = "pending";
  }

  if (newStatus !== invoice.status) {
    await supabase.from("invoices").update({ status: newStatus }).eq("id", invoiceId);
  }
}

export interface OpenInvoice {
  id: string;
  student_id: string;
  program_id: string;
  parent_id: string;
  month: string;
  due_date: string;
  status: "pending" | "overdue";
  amount: number;
  balanceCents: number;
  students?: { first_name: string; last_name: string } | null;
  programs?: { name: string } | null;
}

/**
 * Everything a family still owes, oldest first.
 *
 * A family is every child linked to this parent. An invoice is billed to one
 * parent per child, but either parent may be the one who pays, so matching on
 * the invoice's own parent would miss half of them.
 *
 * Invoices with a bank debit already in flight are left out: that money is on
 * its way, and offering it to a Zelle payment too would collect it twice.
 */
export async function openInvoicesForFamily(
  supabase: OpsClient,
  parentId: string
): Promise<OpenInvoice[]> {
  const { data: links } = await supabase
    .from("student_parents")
    .select("student_id")
    .eq("parent_id", parentId);

  const studentIds = (links || []).map((l) => l.student_id);
  if (studentIds.length === 0) return [];

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, student_id, program_id, parent_id, month, due_date, status, amount, created_at, students(first_name, last_name), programs(name), payments(amount)"
    )
    .in("student_id", studentIds)
    .in("status", ["pending", "overdue"])
    .order("due_date")
    .order("created_at");

  return (invoices || [])
    .map((inv: any) => {
      const paid = (inv.payments || []).reduce((s: number, p: any) => s + toCents(p.amount), 0);
      return { ...inv, amount: Number(inv.amount), balanceCents: toCents(inv.amount) - paid };
    })
    .filter((inv) => inv.balanceCents > 0);
}
