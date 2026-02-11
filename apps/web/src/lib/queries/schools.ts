import { createServerSupabase } from "@/lib/supabase/server";
import type { School, Program, Student, Enrollment } from "@/types/database";

export async function getSchools(): Promise<
  (School & { program_count: number; student_count: number })[]
> {
  const supabase = createServerSupabase();

  const { data: schools, error } = await supabase
    .from("schools")
    .select("*")
    .order("name");

  if (error) {
    console.error("Error fetching schools:", error);
    return [];
  }

  if (!schools || schools.length === 0) return [];

  // Fetch program counts and student counts for each school
  const schoolIds = schools.map((s: School) => s.id);

  const { data: programs } = await supabase
    .from("programs")
    .select("id, school_id")
    .in("school_id", schoolIds);

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("student_id, program_id")
    .eq("status", "active");

  const programsBySchool = new Map<string, string[]>();
  for (const program of programs || []) {
    const existing = programsBySchool.get(program.school_id) || [];
    existing.push(program.id);
    programsBySchool.set(program.school_id, existing);
  }

  const studentsBySchool = new Map<string, Set<string>>();
  for (const enrollment of enrollments || []) {
    for (const [schoolId, programIds] of programsBySchool.entries()) {
      if (programIds.includes(enrollment.program_id)) {
        const existing = studentsBySchool.get(schoolId) || new Set();
        existing.add(enrollment.student_id);
        studentsBySchool.set(schoolId, existing);
      }
    }
  }

  return schools.map((school: School) => ({
    ...school,
    program_count: programsBySchool.get(school.id)?.length || 0,
    student_count: studentsBySchool.get(school.id)?.size || 0,
  }));
}

export async function getSchool(id: string): Promise<School | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("schools")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching school:", error);
    return null;
  }

  return data;
}

export async function getSchoolWithPrograms(
  id: string
): Promise<{ school: School; programs: Program[] } | null> {
  const supabase = createServerSupabase();

  const { data: school, error: schoolError } = await supabase
    .from("schools")
    .select("*")
    .eq("id", id)
    .single();

  if (schoolError || !school) {
    console.error("Error fetching school:", schoolError);
    return null;
  }

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select("*")
    .eq("school_id", id)
    .order("start_date", { ascending: false });

  if (programsError) {
    console.error("Error fetching programs:", programsError);
    return { school, programs: [] };
  }

  return { school, programs: programs || [] };
}

export type SchoolStudent = Student & {
  enrollment_status: Enrollment["status"];
  program_name: string;
  parent_name: string | null;
};

export async function getSchoolStudents(
  schoolId: string
): Promise<SchoolStudent[]> {
  const supabase = createServerSupabase();

  // Get all programs for this school
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name")
    .eq("school_id", schoolId);

  if (!programs || programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);
  const programMap = new Map(programs.map((p) => [p.id, p.name]));

  // Get enrollments for those programs
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("student_id, program_id, status")
    .in("program_id", programIds);

  if (!enrollments || enrollments.length === 0) return [];

  // Get unique student IDs
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];

  // Get students
  const { data: students } = await supabase
    .from("students")
    .select("*")
    .in("id", studentIds)
    .order("last_name");

  if (!students || students.length === 0) return [];

  // Get parent relationships
  const { data: studentParents } = await supabase
    .from("student_parents")
    .select("student_id, parent_id")
    .in("student_id", studentIds);

  let parentMap = new Map<string, string>();
  if (studentParents && studentParents.length > 0) {
    const parentIds = [...new Set(studentParents.map((sp) => sp.parent_id))];
    const { data: parents } = await supabase
      .from("parents")
      .select("id, first_name, last_name")
      .in("id", parentIds);

    if (parents) {
      const parentNameMap = new Map(
        parents.map((p) => [p.id, `${p.first_name} ${p.last_name}`])
      );
      for (const sp of studentParents) {
        parentMap.set(sp.student_id, parentNameMap.get(sp.parent_id) || "");
      }
    }
  }

  // Build enrollment map (student_id -> first enrollment found)
  const enrollmentMap = new Map<
    string,
    { status: Enrollment["status"]; program_id: string }
  >();
  for (const e of enrollments) {
    if (!enrollmentMap.has(e.student_id)) {
      enrollmentMap.set(e.student_id, {
        status: e.status,
        program_id: e.program_id,
      });
    }
  }

  return students.map((student: Student) => {
    const enrollment = enrollmentMap.get(student.id);
    return {
      ...student,
      enrollment_status: enrollment?.status || "active",
      program_name: enrollment
        ? programMap.get(enrollment.program_id) || ""
        : "",
      parent_name: parentMap.get(student.id) || null,
    };
  });
}
