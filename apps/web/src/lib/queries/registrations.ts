import { createAdminSupabase, createAdminPublicSupabase } from "@/lib/supabase/server";
import type { ProgramAvailability, Registration } from "@/types/database";

export type RegistrationWithProgram = Registration & {
  program: { id: string; name: string; school: { id: string; name: string } | null } | null;
  enrollment: { status: "active" | "withdrawn" | "completed" } | null;
  /** The child's latest invoice for this program — what "Paid" is read from. */
  invoice: { status: "pending" | "processing" | "paid" | "overdue" | "waived"; month: string } | null;
};

export async function getRegistrations() {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("registrations")
    .select("*, program:programs(id, name, school:schools(id, name)), enrollment:enrollments(status)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];

  // Paid means an invoice with the money behind it, never a label set by hand.
  const studentIds = Array.from(new Set(rows.map((r) => r.student_id).filter(Boolean)));
  const latest = new Map<string, { status: string; month: string }>();
  if (studentIds.length) {
    const { data: invoices, error: invError } = await supabase
      .from("invoices")
      .select("student_id, program_id, status, month")
      .in("student_id", studentIds)
      .order("month", { ascending: false });
    if (invError) throw invError;
    for (const inv of invoices ?? []) {
      const key = `${inv.student_id}|${inv.program_id}`;
      if (!latest.has(key)) latest.set(key, { status: inv.status, month: inv.month });
    }
  }

  return rows.map((r) => ({
    ...r,
    invoice: latest.get(`${r.student_id}|${r.program_id}`) ?? null,
  })) as RegistrationWithProgram[];
}

/** Seat counts per program, used for the capacity bars on the registrations page. */
export async function getProgramAvailability() {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("program_availability")
    .select("*")
    .order("school_name")
    .order("name");

  if (error) throw error;
  return (data ?? []) as ProgramAvailability[];
}

export interface WebsiteListing {
  id: string;
  title: string;
  type: string;
  ops_program_id: string | null;
}

/**
 * Program listings on the marketing site (`public.programs`).
 *
 * These are CMS rows edited at risingstars.training/admin — separate from the
 * operational programs that own rosters. Linking one to a program is what makes
 * the website show live seat counts and take real registrations.
 */
export async function getWebsiteListings() {
  const supabase = createAdminPublicSupabase();

  const { data, error } = await supabase
    .from("programs")
    .select("id, title, type, ops_program_id")
    .order("title");

  if (error) throw error;
  return (data ?? []) as WebsiteListing[];
}
