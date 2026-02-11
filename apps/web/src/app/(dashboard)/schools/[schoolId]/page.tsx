import { notFound } from "next/navigation";
import { getSchoolWithPrograms, getSchoolStudents } from "@/lib/queries/schools";
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

  const students = await getSchoolStudents(params.schoolId);

  return (
    <SchoolDetailClient
      school={result.school}
      programs={result.programs}
      students={students}
    />
  );
}
