import { getLeads } from "@/lib/queries/leads";
import { getInquiries } from "@/lib/queries/inquiries";
import { MarketingPageClient } from "@/components/marketing-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: { tab?: string } }) {
  const [leads, inquiries] = await Promise.all([getLeads(), getInquiries()]);
  return <MarketingPageClient leads={leads} inquiries={inquiries} initialTab={searchParams?.tab} />;
}
