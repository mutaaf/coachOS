import { getClearanceDashboard, getCompliancePickers, getIncidents, getPrivacyRequests } from "@/lib/queries/compliance";
import { CompliancePageClient } from "@/components/compliance-page-client";
import { RETENTION } from "@/lib/retention";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request.
export const dynamic = "force-dynamic";

export default async function CompliancePage({ searchParams }: { searchParams: { tab?: string } }) {
  const [requests, incidents, coaches, pickers] = await Promise.all([
    getPrivacyRequests(),
    getIncidents(),
    getClearanceDashboard(),
    getCompliancePickers(),
  ]);
  return (
    <CompliancePageClient
      requests={requests}
      incidents={incidents}
      coaches={coaches}
      pickers={pickers}
      retention={RETENTION}
      initialTab={searchParams?.tab}
    />
  );
}
