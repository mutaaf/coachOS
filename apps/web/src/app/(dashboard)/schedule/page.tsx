import { getSessions } from "@/lib/queries/schedule";
import { SchedulePageClient } from "@/components/schedule-page-client";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function SchedulePage() {
  const supabase = createServerSupabase();

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const [sessions, programsRes] = await Promise.all([
    getSessions({
      startDate: startOfWeek.toISOString().split("T")[0],
      endDate: endOfWeek.toISOString().split("T")[0],
    }),
    supabase.from("programs").select("*, schools(*)").eq("status", "active"),
  ]);

  return (
    <SchedulePageClient
      initialSessions={sessions}
      programs={programsRes.data || []}
    />
  );
}
