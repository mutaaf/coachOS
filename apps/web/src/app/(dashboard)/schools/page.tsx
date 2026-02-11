import { getSchools } from "@/lib/queries/schools";
import { SchoolsPageClient } from "@/components/schools-page-client";

export default async function SchoolsPage() {
  const schools = await getSchools();

  return (
    <div className="space-y-0">
      <SchoolsPageClient schools={schools} />
    </div>
  );
}
