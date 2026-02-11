import { getStudents, getParents } from "@/lib/queries/students";
import { StudentsPageClient } from "@/components/students-page-client";

export default async function StudentsPage() {
  const [students, parents] = await Promise.all([getStudents(), getParents()]);

  return <StudentsPageClient students={students} parents={parents} />;
}
