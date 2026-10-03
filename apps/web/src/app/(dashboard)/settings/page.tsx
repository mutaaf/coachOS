import { getConfig } from "@/lib/queries/config";
import { SettingsPageClient } from "@/components/settings-page-client";
import { listAccess } from "@/lib/actions/access";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [config, people] = await Promise.all([getConfig(), listAccess()]);

  return <SettingsPageClient config={config} people={people ?? []} />;
}
