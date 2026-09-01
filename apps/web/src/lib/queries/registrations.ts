import { createAdminSupabase, createAdminPublicSupabase } from "@/lib/supabase/server";
import type { ProgramAvailability, Registration } from "@/types/database";

export type RegistrationWithProgram = Registration & {
  program: { id: string; name: string; school: { id: string; name: string } | null } | null;
};

export async function getRegistrations() {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from("registrations")
    .select("*, program:programs(id, name, school:schools(id, name))")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as RegistrationWithProgram[];
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
