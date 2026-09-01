import { getLeads } from "@/lib/queries/leads";
import { MarketingPageClient } from "@/components/marketing-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const leads = await getLeads();
  return <MarketingPageClient leads={leads} />;
}
