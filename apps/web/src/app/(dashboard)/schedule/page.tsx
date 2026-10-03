import { getSessions } from "@/lib/queries/schedule";
import { getActivePrograms } from "@/lib/queries/programs";
import { getAssignableCoaches } from "@/lib/queries/coaches";
import { businessWeek } from "@/lib/dates";
import { SchedulePageClient } from "@/components/schedule-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  // This week in Dallas — the server's clock is UTC.
  const week = businessWeek();

  const [sessions, programs, coaches] = await Promise.all([
    getSessions({
      startDate: week[0],
      endDate: week[6],
    }),
    getActivePrograms(),
    getAssignableCoaches(),
  ]);

  return (
    <SchedulePageClient
      initialSessions={sessions}
      programs={programs}
      coaches={coaches}
    />
  );
}
