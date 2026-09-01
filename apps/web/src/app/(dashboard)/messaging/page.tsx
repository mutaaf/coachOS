import { getMessageTemplates, getMessageLog, getMessageStats } from "@/lib/queries/messages";
import { getSchools } from "@/lib/queries/schools";
import { getActivePrograms } from "@/lib/queries/programs";
import { MessagingPageClient } from "@/components/messaging-page-client";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function MessagingPage() {
  const [templates, log, stats, schools, programs] = await Promise.all([
    getMessageTemplates(),
    getMessageLog(),
    getMessageStats(),
    getSchools(),
    getActivePrograms(),
  ]);

  return <MessagingPageClient templates={templates} log={log} stats={stats} schools={schools} programs={programs} />;
}
