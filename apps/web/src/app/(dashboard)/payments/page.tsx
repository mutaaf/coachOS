import {
  getInvoices,
  getPayments,
  getPaymentSummary,
  getOverdueInvoices,
  getZelleInbox,
  getAutopaySummary,
} from "@/lib/queries/payments";
import { countFamiliesToInvite } from "@/lib/actions/autopay";
import { getAssignOptions } from "@/lib/queries/payment-assign";
import { PaymentsPageClient } from "@/components/payments-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: { status?: string } }) {
  // Update overdue status first
  await getOverdueInvoices();

  const [summary, invoices, payments, zelle, assign, autopay, inviteCount] = await Promise.all([
    getPaymentSummary(),
    getInvoices(),
    getPayments(),
    getZelleInbox(),
    getAssignOptions(),
    getAutopaySummary(),
    countFamiliesToInvite(),
  ]);

  return (
    <PaymentsPageClient
      summary={summary}
      invoices={invoices}
      payments={payments}
      collect={{ zelle, assign, autopay, inviteCount }}
      initialStatus={searchParams.status}
    />
  );
}
