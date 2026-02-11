import { getConfig, getWhatsAppState } from "@/lib/queries/config";
import { SettingsPageClient } from "@/components/settings-page-client";

export default async function SettingsPage() {
  const [config, whatsappState] = await Promise.all([
    getConfig(),
    getWhatsAppState(),
  ]);

  return <SettingsPageClient config={config} whatsappState={whatsappState} />;
}
