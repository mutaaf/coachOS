import { getInvoices, getPayments, getPaymentSummary, getOverdueInvoices } from "@/lib/queries/payments";
import { PaymentsPageClient } from "@/components/payments-page-client";

export default async function PaymentsPage() {
  // Update overdue status first
  await getOverdueInvoices();

  const [summary, invoices, payments] = await Promise.all([
    getPaymentSummary(),
    getInvoices(),
    getPayments(),
  ]);

  return <PaymentsPageClient summary={summary} invoices={invoices} payments={payments} />;
}
