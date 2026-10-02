import { getSchools, getImportOptions } from "@/lib/queries/schools";
import { SchoolsPageClient } from "@/components/schools-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

// Reading roster screenshots takes up to a minute; the default limit would cut it off.
export const maxDuration = 120;

export default async function SchoolsPage() {
  const [schools, importOptions] = await Promise.all([getSchools(), getImportOptions()]);

  return (
    <div className="space-y-0">
      <SchoolsPageClient schools={schools} importOptions={importOptions} />
    </div>
  );
}
