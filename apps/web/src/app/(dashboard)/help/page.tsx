import { HelpPageClient } from "@/components/help-page-client";
import { getTestResults } from "@/lib/queries/onboarding";
import { getStripeSettings } from "@/lib/stripe-client";

// Test results change as they are recorded; read fresh each time.
export const dynamic = "force-dynamic";

export default async function HelpPage({ searchParams }: { searchParams: { tab?: string } }) {
  const [results, stripe] = await Promise.all([getTestResults(), getStripeSettings()]);
  return <HelpPageClient results={results} testMode={stripe.mode === "test"} initialTab={searchParams.tab} />;
}
