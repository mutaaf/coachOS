import { getSchools } from "@/lib/queries/schools";
import { SchoolsPageClient } from "@/components/schools-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function SchoolsPage() {
  const schools = await getSchools();

  return (
    <div className="space-y-0">
      <SchoolsPageClient schools={schools} />
    </div>
  );
}
