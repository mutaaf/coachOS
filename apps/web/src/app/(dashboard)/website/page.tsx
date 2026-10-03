import { WebsitePageClient } from "@/components/website-page-client";
import { getWebsite } from "@/lib/queries/website";
import { businessToday } from "@/lib/dates";

// The site's content changes when it's edited here; never serve a cached copy.
export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const data = await getWebsite();
  return <WebsitePageClient {...data} today={businessToday()} />;
}
