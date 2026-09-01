import { getStudents, getParents } from "@/lib/queries/students";
import { getEnrollablePrograms } from "@/lib/queries/programs";
import { StudentsPageClient } from "@/components/students-page-client";

export default async function StudentsPage() {
  const [students, parents, enrollablePrograms] = await Promise.all([
    getStudents(),
    getParents(),
    getEnrollablePrograms(),
  ]);

  return (
    <StudentsPageClient
      students={students}
      parents={parents}
      enrollablePrograms={enrollablePrograms}
    />
  );
}
