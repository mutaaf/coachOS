import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";
import { evaluateClearance, type ClearanceFields, type CoachClearance } from "@/lib/coach-clearance";
import type { Incident, Inquiry } from "@/types/database";

/**
 * What the Compliance page shows: privacy requests and their deadlines,
 * incident reports, and every active coach's safeguarding status. Admins only
 * (the page sits behind the dashboard's sign-in).
 */

export type PrivacyRequestRow = Inquiry & {
  family: { id: string; first_name: string; last_name: string; anonymized_at: string | null } | null;
};

export async function getPrivacyRequests(): Promise<PrivacyRequestRow[]> {
  const { data, error } = await createAdminSupabase()
    .from("inquiries")
    .select("*, family:parents(id, first_name, last_name, anonymized_at)")
    .eq("kind", "privacy_request")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as PrivacyRequestRow[];
}

export type IncidentRow = Incident & {
  student: { id: string; first_name: string; last_name: string } | null;
  program: { id: string; name: string } | null;
};

export async function getIncidents(): Promise<IncidentRow[]> {
  const { data, error } = await createAdminSupabase()
    .from("incidents")
    .select("*, student:students(id, first_name, last_name), program:programs(id, name)")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as IncidentRow[];
}

export type CoachClearanceRow = {
  id: string;
  name: string;
  status: string;
  clearance: CoachClearance;
};

/** Active and prospective coaches, least cleared first. */
export async function getClearanceDashboard(today: string = businessToday()): Promise<CoachClearanceRow[]> {
  const { data, error } = await createAdminSupabase()
    .from("coaches")
    .select("*")
    .in("status", ["active", "prospective"])
    .order("first_name");
  if (error) throw error;
  const order = { not_cleared: 0, expiring: 1, cleared: 2 } as const;
  return (data ?? [])
    .map((c: any) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      status: c.status,
      clearance: evaluateClearance(c as ClearanceFields, today),
    }))
    .sort((a, b) => order[a.clearance.status] - order[b.clearance.status]);
}

/** Choices for the incident form and for linking a privacy request to a family. */
export async function getCompliancePickers() {
  const supabase = createAdminSupabase();
  const [students, programs, parents, coaches] = await Promise.all([
    supabase.from("students").select("id, first_name, last_name").is("anonymized_at", null).order("first_name"),
    supabase.from("programs").select("id, name").in("status", ["active", "upcoming", "completed"]).order("name"),
    supabase.from("parents").select("id, first_name, last_name, phone, email").is("anonymized_at", null).order("last_name"),
    supabase.from("coaches").select("id, first_name, last_name").in("status", ["active", "prospective"]).order("first_name"),
  ]);
  return {
    students: (students.data ?? []) as { id: string; first_name: string; last_name: string }[],
    programs: (programs.data ?? []) as { id: string; name: string }[],
    parents: (parents.data ?? []) as { id: string; first_name: string; last_name: string; phone: string; email: string | null }[],
    coaches: (coaches.data ?? []) as { id: string; first_name: string; last_name: string }[],
  };
}
