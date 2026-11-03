import { redirect } from "next/navigation";
import { getClearanceDashboard, getCompliancePickers, getIncidents, getPrivacyRequests } from "@/lib/queries/compliance";
import { getAuditLog, getChecklist, getPolicyFacts } from "@/lib/queries/audit-compliance";
import { CompliancePageClient } from "@/components/compliance-page-client";
import { RETENTION } from "@/lib/retention";
import { currentStaff } from "@/lib/auth-guard";
import { businessToday } from "@/lib/dates";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request.
export const dynamic = "force-dynamic";

type Search = { tab?: string; kind?: string; actor?: string; from?: string; to?: string };

/**
 * Audit & Compliance. Admins see every tab; the compliance role sees policy
 * facts, the checklist and their part of the audit log — the family-facing
 * tabs (privacy requests, incidents, coach clearance) are never even fetched
 * for them.
 */
export default async function CompliancePage({ searchParams }: { searchParams: Search }) {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const filters = { kind: searchParams?.kind, actor: searchParams?.actor, from: searchParams?.from, to: searchParams?.to };

  const [facts, checklist, audit] = await Promise.all([getPolicyFacts(), getChecklist(), getAuditLog(filters)]);

  const admin =
    staff.role === "admin"
      ? await Promise.all([getPrivacyRequests(), getIncidents(), getClearanceDashboard(), getCompliancePickers()]).then(
          ([requests, incidents, coaches, pickers]) => ({ requests, incidents, coaches, pickers, retention: RETENTION })
        )
      : null;

  return (
    <CompliancePageClient
      role={staff.role}
      today={businessToday()}
      facts={facts}
      checklist={checklist}
      audit={audit}
      auditFilters={filters}
      admin={admin}
      initialTab={searchParams?.tab}
    />
  );
}
