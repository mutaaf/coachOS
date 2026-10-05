import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";
import type { Coach } from "@/types/database";
import { CLEARANCE_COLUMNS, evaluateClearance, type ClearanceFields, type CoachClearance } from "@/lib/coach-clearance";

export type CoachWithWorkload = Coach & {
  /** Sessions already run — what they have earned. */
  sessions_completed: number;
  /** Sessions still on the calendar for them. */
  sessions_upcoming: number;
  /** Recurring weekly slots they are the named coach for. */
  weekly_slots: number;
  /** Owed for completed sessions, when a per-session rate is set. */
  owed: number | null;
  /** Safeguarding: background check, training, CPR, code of conduct. */
  clearance: CoachClearance;
};

/**
 * Coaches with the work attached to them.
 *
 * The counts matter more than the contact details: the reason to open this page
 * is usually "who is covering Tuesday" or "what do I owe Ahmed", and both were
 * previously answerable only from memory.
 */
export async function getCoaches(): Promise<CoachWithWorkload[]> {
  const supabase = createAdminSupabase();
  const today = businessToday();

  const [{ data: coaches, error }, { data: sessions }, { data: templates }] =
    await Promise.all([
      supabase.from("coaches").select("*").order("status").order("first_name"),
      supabase.from("sessions").select("coach_id, date, status").not("coach_id", "is", null),
      supabase.from("schedule_templates").select("coach_id").not("coach_id", "is", null),
    ]);

  if (error) throw error;

  return (coaches ?? []).map((coach) => {
    const theirs = (sessions ?? []).filter((s) => s.coach_id === coach.id);

    // A session counts as worked once it has happened and wasn't cancelled —
    // "completed" is only set when someone marks it, and in a busy week nobody
    // does, so past-and-not-cancelled is the honest measure.
    const completed = theirs.filter(
      (s) => s.status !== "cancelled" && s.date <= today
    ).length;
    const upcoming = theirs.filter(
      (s) => s.status === "scheduled" && s.date > today
    ).length;

    const rate = coach.pay_rate === null ? null : Number(coach.pay_rate);

    return {
      ...coach,
      sessions_completed: completed,
      sessions_upcoming: upcoming,
      weekly_slots: (templates ?? []).filter((t) => t.coach_id === coach.id).length,
      // Only per-session rates can be totalled from session counts; an hourly
      // coach needs real hours, which nothing records yet.
      owed: rate !== null && coach.pay_type === "per_session" ? rate * completed : null,
      clearance: evaluateClearance(coach as ClearanceFields, today),
    };
  }) as CoachWithWorkload[];
}

/**
 * Active coaches only, for assignment dropdowns. Each says whether they are
 * cleared to work with children, so a picker can warn before one who isn't
 * is put in charge of a practice.
 */
export async function getAssignableCoaches(): Promise<
  { id: string; first_name: string; last_name: string; cleared: boolean; clearance: CoachClearance }[]
> {
  const supabase = createAdminSupabase();
  const today = businessToday();

  const { data, error } = await supabase
    .from("coaches")
    .select(`first_name, last_name, ${CLEARANCE_COLUMNS}`)
    .eq("status", "active")
    .order("first_name");

  if (error) throw error;
  return ((data ?? []) as unknown as (ClearanceFields & { first_name: string; last_name: string })[]).map((c) => {
    const clearance = evaluateClearance(c, today);
    return { id: c.id, first_name: c.first_name, last_name: c.last_name, cleared: clearance.status !== "not_cleared", clearance };
  });
}
