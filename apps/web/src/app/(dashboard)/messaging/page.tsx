import { getMessageTemplates, getMessageLog, getMessageStats } from "@/lib/queries/messages";
import { MessagingPageClient } from "@/components/messaging-page-client";

export default async function MessagingPage() {
  const [templates, log, stats] = await Promise.all([
    getMessageTemplates(),
    getMessageLog(),
    getMessageStats(),
  ]);

  return <MessagingPageClient templates={templates} log={log} stats={stats} />;
}
