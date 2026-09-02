import { getSessions } from "@/lib/queries/schedule";
import { getActivePrograms } from "@/lib/queries/programs";
import { getAssignableCoaches } from "@/lib/queries/coaches";
import { toISODate } from "@/lib/dates";
import { SchedulePageClient } from "@/components/schedule-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const [sessions, programs, coaches] = await Promise.all([
    getSessions({
      startDate: toISODate(startOfWeek),
      endDate: toISODate(endOfWeek),
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
