import { notFound } from "next/navigation";
import {
  getSchoolWithPrograms,
  getSchoolStudents,
  getSchoolSessions,
  getSchoolInvoices,
} from "@/lib/queries/schools";
import { getSchools } from "@/lib/queries/schools";
import { getParents } from "@/lib/queries/students";
import { getWebsiteListings } from "@/lib/queries/registrations";
import { SchoolDetailClient } from "@/components/school-detail-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

interface SchoolDetailPageProps {
  params: { schoolId: string };
}

export default async function SchoolDetailPage({
  params,
}: SchoolDetailPageProps) {
  const result = await getSchoolWithPrograms(params.schoolId);

  if (!result) {
    notFound();
  }

  const [
    students,
    { templates, sessions },
    invoices,
    allSchools,
    allParents,
    websiteListings,
  ] = await Promise.all([
    getSchoolStudents(params.schoolId),
    getSchoolSessions(params.schoolId),
    getSchoolInvoices(params.schoolId),
    getSchools(),
    getParents(),
    getWebsiteListings(),
  ]);

  return (
    <SchoolDetailClient
      school={result.school}
      programs={result.programs}
      students={students}
      scheduleTemplates={templates}
      upcomingSessions={sessions}
      invoices={invoices}
      allSchools={allSchools}
      allParents={allParents}
      websiteListings={websiteListings}
    />
  );
}
