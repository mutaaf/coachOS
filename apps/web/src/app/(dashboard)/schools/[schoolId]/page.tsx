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
