import { getSessions } from "@/lib/queries/schedule";
import { getActivePrograms } from "@/lib/queries/programs";
import { SchedulePageClient } from "@/components/schedule-page-client";

export default async function SchedulePage() {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const [sessions, programs] = await Promise.all([
    getSessions({
      startDate: startOfWeek.toISOString().split("T")[0],
      endDate: endOfWeek.toISOString().split("T")[0],
    }),
    getActivePrograms(),
  ]);

  return (
    <SchedulePageClient
      initialSessions={sessions}
      programs={programs}
    />
  );
}
