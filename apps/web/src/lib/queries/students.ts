import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Student,
  Parent,
  StudentParent,
  Enrollment,
  Program,
  School,
  StudentWithParents,
} from "@/types/database";

export type ParentWithStudents = Parent & {
  students: (Student & { relationship: string })[];
};

export type StudentWithDetails = Student & {
  parents: (Parent & { relationship: string })[];
  enrollments: (Enrollment & {
    program: Program & { school: School };
  })[];
};

export async function getStudents(): Promise<StudentWithParents[]> {
  const supabase = createServerSupabase();

  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("*")
    .order("last_name");

  if (studentsError) {
    console.error("Error fetching students:", studentsError);
    return [];
  }

  if (!students || students.length === 0) return [];

  const studentIds = students.map((s: Student) => s.id);

  const { data: links, error: linksError } = await supabase
    .from("student_parents")
    .select("*, parents(*)")
    .in("student_id", studentIds);

  if (linksError) {
    console.error("Error fetching student-parent links:", linksError);
    return students.map((s: Student) => ({ ...s, parents: [] }));
  }

  const parentsByStudent = new Map<
    string,
    (Parent & { relationship: string })[]
  >();

  for (const link of links || []) {
    const parent = link.parents as unknown as Parent;
    if (!parent) continue;

    const existing = parentsByStudent.get(link.student_id) || [];
    existing.push({ ...parent, relationship: link.relationship });
    parentsByStudent.set(link.student_id, existing);
  }

  return students.map((student: Student) => ({
    ...student,
    parents: parentsByStudent.get(student.id) || [],
  }));
}

export async function getStudent(
  id: string
): Promise<StudentWithDetails | null> {
  const supabase = createServerSupabase();

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("*")
    .eq("id", id)
    .single();

  if (studentError || !student) {
    console.error("Error fetching student:", studentError);
    return null;
  }

  // Fetch parents
  const { data: parentLinks } = await supabase
    .from("student_parents")
    .select("*, parents(*)")
    .eq("student_id", id);

  const parents: (Parent & { relationship: string })[] = (
    parentLinks || []
  ).map((link: StudentParent & { parents: Parent }) => ({
    ...(link.parents as unknown as Parent),
    relationship: link.relationship,
  }));

  // Fetch enrollments with program and school info
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, programs(*, schools(*))")
    .eq("student_id", id);

  const enrichedEnrollments = (enrollments || []).map(
    (enrollment: Enrollment & { programs: Program & { schools: School } }) => ({
      ...enrollment,
      program: {
        ...(enrollment.programs as unknown as Program & { schools: School }),
        school: (enrollment.programs as unknown as Program & { schools: School })
          .schools,
      },
      programs: undefined,
    })
  );

  return {
    ...student,
    parents,
    enrollments: enrichedEnrollments,
  } as StudentWithDetails;
}

export async function getParents(): Promise<ParentWithStudents[]> {
  const supabase = createServerSupabase();

  const { data: parents, error: parentsError } = await supabase
    .from("parents")
    .select("*")
    .order("last_name");

  if (parentsError) {
    console.error("Error fetching parents:", parentsError);
    return [];
  }

  if (!parents || parents.length === 0) return [];

  const parentIds = parents.map((p: Parent) => p.id);

  const { data: links, error: linksError } = await supabase
    .from("student_parents")
    .select("*, students(*)")
    .in("parent_id", parentIds);

  if (linksError) {
    console.error("Error fetching parent-student links:", linksError);
    return parents.map((p: Parent) => ({ ...p, students: [] }));
  }

  const studentsByParent = new Map<
    string,
    (Student & { relationship: string })[]
  >();

  for (const link of links || []) {
    const student = link.students as unknown as Student;
    if (!student) continue;

    const existing = studentsByParent.get(link.parent_id) || [];
    existing.push({ ...student, relationship: link.relationship });
    studentsByParent.set(link.parent_id, existing);
  }

  return parents.map((parent: Parent) => ({
    ...parent,
    students: studentsByParent.get(parent.id) || [],
  }));
}

export async function getParent(
  id: string
): Promise<ParentWithStudents | null> {
  const supabase = createServerSupabase();

  const { data: parent, error: parentError } = await supabase
    .from("parents")
    .select("*")
    .eq("id", id)
    .single();

  if (parentError || !parent) {
    console.error("Error fetching parent:", parentError);
    return null;
  }

  const { data: links } = await supabase
    .from("student_parents")
    .select("*, students(*)")
    .eq("parent_id", id);

  const students: (Student & { relationship: string })[] = (
    links || []
  ).map((link: StudentParent & { students: Student }) => ({
    ...(link.students as unknown as Student),
    relationship: link.relationship,
  }));

  return {
    ...parent,
    students,
  } as ParentWithStudents;
}
