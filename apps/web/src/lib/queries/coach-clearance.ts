import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";
import { CLEARANCE_COLUMNS, evaluateClearance, type ClearanceFields, type CoachClearance } from "@/lib/coach-clearance";

/**
 * Is this coach cleared to work with children? For server components and
 * server actions — e.g. the program-creation flow, before or after a coach is
 * picked:
 *
 *   const clearance = await getCoachClearance(coachId);
 *   if (clearance && clearance.status === "not_cleared") …
 *   <CoachClearanceBadge clearance={clearance} />
 *
 * Null when there is no such coach. Not a server action: call it from server
 * code that has already checked the caller is signed in.
 */
export async function getCoachClearance(coachId: string, today: string = businessToday()): Promise<CoachClearance | null> {
  const { data } = await createAdminSupabase().from("coaches").select(CLEARANCE_COLUMNS).eq("id", coachId).maybeSingle();
  return data ? evaluateClearance(data as unknown as ClearanceFields, today) : null;
}

/** Every coach's clearance, keyed by id — for lists and pickers. */
export async function getCoachClearances(
  opts: { activeOnly?: boolean } = {},
  today: string = businessToday()
): Promise<Record<string, CoachClearance>> {
  let query = createAdminSupabase().from("coaches").select(`${CLEARANCE_COLUMNS}, status`);
  if (opts.activeOnly) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as unknown as ClearanceFields[]).map((c) => [c.id, evaluateClearance(c, today)])
  );
}
