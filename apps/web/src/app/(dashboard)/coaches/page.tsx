import { getCoaches } from "@/lib/queries/coaches";
import { CoachesPageClient } from "@/components/coaches-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  const coaches = await getCoaches();
  return <CoachesPageClient coaches={coaches} />;
}
