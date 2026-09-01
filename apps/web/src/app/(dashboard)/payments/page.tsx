import { getInvoices, getPayments, getPaymentSummary, getOverdueInvoices } from "@/lib/queries/payments";
import { PaymentsPageClient } from "@/components/payments-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

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
