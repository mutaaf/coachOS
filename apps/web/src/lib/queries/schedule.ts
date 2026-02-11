import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Session,
  ScheduleTemplate,
  Program,
  School,
  Attendance,
  Student,
} from "@/types/database";

// ---------- Schedule Templates ----------

export type ScheduleTemplateWithProgram = ScheduleTemplate & {
  program: Program & { school: School };
};

export async function getScheduleTemplates(
  programId?: string
): Promise<ScheduleTemplateWithProgram[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("schedule_templates")
    .select("*, programs(*, schools(*))")
    .order("day_of_week")
    .order("start_time");

  if (programId) {
    query = query.eq("program_id", programId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching schedule templates:", error);
    return [];
  }

  return (data || []).map((template: any) => ({
    ...template,
    program: {
      ...template.programs,
      school: template.programs?.schools ?? null,
    },
    programs: undefined,
  }));
}

// ---------- Sessions ----------

export type SessionWithProgram = Session & {
  program: Program & { school: School };
};

export type SessionWithAttendance = Session & {
  program: Program & { school: School };
  attendance: (Attendance & { student: Student })[];
};

export async function getSessions(filters: {
  startDate?: string;
  endDate?: string;
  programId?: string;
  status?: string;
}): Promise<SessionWithProgram[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("sessions")
    .select("*, programs(*, schools(*))")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (filters.startDate) {
    query = query.gte("date", filters.startDate);
  }
  if (filters.endDate) {
    query = query.lte("date", filters.endDate);
  }
  if (filters.programId) {
    query = query.eq("program_id", filters.programId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching sessions:", error);
    return [];
  }

  return (data || []).map((session: any) => ({
    ...session,
    program: {
      ...session.programs,
      school: session.programs?.schools ?? null,
    },
    programs: undefined,
  }));
}

export async function getSession(
  id: string
): Promise<SessionWithAttendance | null> {
  const supabase = createServerSupabase();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("*, programs(*, schools(*))")
    .eq("id", id)
    .single();

  if (sessionError || !session) {
    console.error("Error fetching session:", sessionError);
    return null;
  }

  // Fetch attendance records with student info
  const { data: attendanceRecords, error: attendanceError } = await supabase
    .from("attendance")
    .select("*, students(*)")
    .eq("session_id", id);

  if (attendanceError) {
    console.error("Error fetching attendance:", attendanceError);
  }

  const attendance = (attendanceRecords || []).map((record: any) => ({
    ...record,
    student: record.students,
    students: undefined,
  }));

  return {
    ...session,
    program: {
      ...(session as any).programs,
      school: (session as any).programs?.schools ?? null,
    },
    programs: undefined,
    attendance,
  } as SessionWithAttendance;
}

export async function getUpcomingSessions(
  limit: number = 5
): Promise<SessionWithProgram[]> {
  const today = new Date().toISOString().split("T")[0];

  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .select("*, programs(*, schools(*))")
    .gte("date", today)
    .eq("status", "scheduled")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("Error fetching upcoming sessions:", error);
    return [];
  }

  return (data || []).map((session: any) => ({
    ...session,
    program: {
      ...session.programs,
      school: session.programs?.schools ?? null,
    },
    programs: undefined,
  }));
}

export async function getSessionsByDate(
  date: string
): Promise<SessionWithProgram[]> {
  return getSessions({ startDate: date, endDate: date });
}
