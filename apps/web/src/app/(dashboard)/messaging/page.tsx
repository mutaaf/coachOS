import { getMessageTemplates, getMessageLog, getMessageStats } from "@/lib/queries/messages";
import { getSchools } from "@/lib/queries/schools";
import { getActivePrograms } from "@/lib/queries/programs";
import { MessagingPageClient } from "@/components/messaging-page-client";

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
