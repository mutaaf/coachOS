import { getStudents, getParents } from "@/lib/queries/students";
import { getEnrollablePrograms } from "@/lib/queries/programs";
import { StudentsPageClient } from "@/components/students-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

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
