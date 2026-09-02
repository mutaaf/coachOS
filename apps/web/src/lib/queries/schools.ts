import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";
import type { School, Program, Student, Enrollment, ScheduleTemplate, Session, Invoice } from "@/types/database";

export async function getSchools(): Promise<
  (School & { program_count: number; student_count: number })[]
> {
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

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
  const supabase = createAdminSupabase();

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
  enrollment_id: string;
  enrollment_status: Enrollment["status"];
  program_id: string;
  program_name: string;
  parent_name: string | null;
  parent_links: { parent_id: string; relationship: string }[];
};

export async function getSchoolStudents(
  schoolId: string
): Promise<SchoolStudent[]> {
  const supabase = createAdminSupabase();

  // Get all programs for this school
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name")
    .eq("school_id", schoolId);

  if (!programs || programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);
  const programMap = new Map(programs.map((p) => [p.id, p.name]));

  // Get enrollments for those programs (include enrollment id)
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, student_id, program_id, status")
    .in("program_id", programIds);

  if (!enrollments || enrollments.length === 0) return [];

  // Get unique student IDs
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];

  // Get students
  const { data: students } = await supabase
    .from("students")
    .select("*")
    .in("id", studentIds);

  if (!students || students.length === 0) return [];

  const studentMap = new Map(students.map((s: Student) => [s.id, s]));

  // Get parent relationships
  const { data: studentParents } = await supabase
    .from("student_parents")
    .select("student_id, parent_id, relationship")
    .in("student_id", studentIds);

  let parentMap = new Map<string, string>();
  const parentLinksMap = new Map<string, { parent_id: string; relationship: string }[]>();
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
        const existing = parentLinksMap.get(sp.student_id) || [];
        existing.push({ parent_id: sp.parent_id, relationship: sp.relationship });
        parentLinksMap.set(sp.student_id, existing);
      }
    }
  }

  // Build one row per enrollment (not per student)
  const result: SchoolStudent[] = [];
  for (const e of enrollments) {
    const student = studentMap.get(e.student_id);
    if (!student) continue;
    result.push({
      ...student,
      enrollment_id: e.id,
      enrollment_status: e.status,
      program_id: e.program_id,
      program_name: programMap.get(e.program_id) || "",
      parent_name: parentMap.get(student.id) || null,
      parent_links: parentLinksMap.get(student.id) || [],
    });
  }

  // Sort by last_name then program_name
  result.sort((a, b) => {
    const lastCmp = a.last_name.localeCompare(b.last_name);
    if (lastCmp !== 0) return lastCmp;
    return a.program_name.localeCompare(b.program_name);
  });

  return result;
}

// ---------- School Sessions (Schedule Tab) ----------

export type SchoolScheduleTemplate = ScheduleTemplate & { program_name: string };
export type SchoolSession = Session & { program_name: string };

export async function getSchoolSessions(schoolId: string): Promise<{
  templates: SchoolScheduleTemplate[];
  sessions: SchoolSession[];
}> {
  const supabase = createAdminSupabase();

  // Get all program IDs for this school
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name")
    .eq("school_id", schoolId);

  if (!programs || programs.length === 0) return { templates: [], sessions: [] };

  const programIds = programs.map((p) => p.id);
  const programMap = new Map(programs.map((p) => [p.id, p.name]));

  // Fetch schedule templates for those programs
  const { data: templates } = await supabase
    .from("schedule_templates")
    .select("*")
    .in("program_id", programIds)
    .order("day_of_week")
    .order("start_time");

  // Fetch upcoming sessions (next 20)
  const today = businessToday();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .in("program_id", programIds)
    .gte("date", today)
    .order("date")
    .order("start_time")
    .limit(20);

  return {
    templates: (templates || []).map((t) => ({
      ...t,
      program_name: programMap.get(t.program_id) || "",
    })),
    sessions: (sessions || []).map((s) => ({
      ...s,
      program_name: programMap.get(s.program_id) || "",
    })),
  };
}

// ---------- School Invoices (Payments Tab) ----------

export type SchoolInvoice = Invoice & {
  student_name: string;
  parent_name: string;
  program_name: string;
};

export async function getSchoolInvoices(schoolId: string): Promise<SchoolInvoice[]> {
  const supabase = createAdminSupabase();

  // Get all program IDs for this school
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name")
    .eq("school_id", schoolId);

  if (!programs || programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);
  const programMap = new Map(programs.map((p) => [p.id, p.name]));

  // Fetch invoices for those programs with joins
  const { data: invoices } = await supabase
    .from("invoices")
    .select("*, parents(first_name, last_name), students(first_name, last_name)")
    .in("program_id", programIds)
    .order("due_date", { ascending: false })
    .limit(50);

  if (!invoices) return [];

  return invoices.map((inv: any) => ({
    ...inv,
    student_name: inv.students
      ? `${inv.students.first_name} ${inv.students.last_name}`
      : "Unknown",
    parent_name: inv.parents
      ? `${inv.parents.first_name} ${inv.parents.last_name}`
      : "Unknown",
    program_name: programMap.get(inv.program_id) || "",
    // Remove nested join objects
    parents: undefined,
    students: undefined,
  }));
}
