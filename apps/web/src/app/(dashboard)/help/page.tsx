import { HelpPageClient } from "@/components/help-page-client";
import { getTestResults } from "@/lib/queries/onboarding";
import { getStripeSettings } from "@/lib/stripe-client";
import { createAdminSupabase } from "@/lib/supabase/server";
import { listReleases } from "@/lib/releases";
import { myReports } from "@/lib/actions/report";

// Test results change as they are recorded; read fresh each time.
export const dynamic = "force-dynamic";

export default async function HelpPage({ searchParams }: { searchParams: { tab?: string } }) {
  const [results, stripe, releases, reports] = await Promise.all([
    getTestResults(),
    getStripeSettings(),
    listReleases(createAdminSupabase()),
    myReports(),
  ]);
  return (
    <HelpPageClient
      results={results}
      testMode={stripe.mode === "test"}
      initialTab={searchParams.tab}
      releases={releases}
      reports={reports as any}
    />
  );
}
