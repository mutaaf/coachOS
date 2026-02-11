import { getLeads } from "@/lib/queries/leads";
import { MarketingPageClient } from "@/components/marketing-page-client";

export default async function MarketingPage() {
  const leads = await getLeads();
  return <MarketingPageClient leads={leads} />;
}
