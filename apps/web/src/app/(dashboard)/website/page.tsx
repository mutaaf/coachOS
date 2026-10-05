import { WebsitePageClient } from "@/components/website-page-client";
import { getWebsite } from "@/lib/queries/website";
import { getPhotoLibrary } from "@/lib/queries/site-media";
import { businessToday } from "@/lib/dates";

// The site's content changes when it's edited here; never serve a cached copy.
export const dynamic = "force-dynamic";
// Photo uploads finish here (resizing a large photo takes a few seconds).
export const maxDuration = 60;

export default async function WebsitePage({ searchParams }: { searchParams: { tab?: string } }) {
  const [data, library] = await Promise.all([getWebsite(), getPhotoLibrary()]);
  return <WebsitePageClient {...data} library={library} tab={searchParams.tab} today={businessToday()} />;
}
