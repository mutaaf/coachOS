"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { updateMultipleConfigs } from "@/lib/actions/config";
import { toast } from "sonner";
import { Settings, MessageSquare, CreditCard, Calendar } from "lucide-react";
import { WhatsAppSetupWizard } from "@/components/whatsapp-setup-wizard";
import type { Config, WhatsAppState } from "@/types/database";

interface SettingsPageClientProps {
  config: Config[];
  whatsappState: WhatsAppState | null;
}

function ConfigField({
  item,
  value,
  onChange,
}: {
  item: Config;
  value: string;
  onChange: (value: string) => void;
}) {
  switch (item.field_type) {
    case "toggle":
      return (
        <div className="flex items-center justify-between rounded-xl border p-4">
          <div>
            <div className="font-medium text-sm">{item.label}</div>
            {item.description && <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>}
          </div>
          <Switch
            checked={value === "true"}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          />
        </div>
      );
    case "number":
      return (
        <div className="space-y-2">
          <Label className="text-sm">{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "time":
      return (
        <div className="space-y-2">
          <Label className="text-sm">{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Input
            type="time"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "select":
      return (
        <div className="space-y-2">
          <Label className="text-sm">{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Select
            options={(item.options || []).map((o) => ({ value: o, label: o }))}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "textarea":
      return (
        <div className="space-y-2">
          <Label className="text-sm">{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
          />
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          <Label className="text-sm">{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

export function SettingsPageClient({ config, whatsappState }: SettingsPageClientProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(config.map((c) => [c.key, c.value]))
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const categories = [...new Set(config.map((c) => c.category))];
  const categoryIcons: Record<string, any> = {
    general: Settings,
    messaging: MessageSquare,
    payments: CreditCard,
    scheduling: Calendar,
  };

  function handleChange(key: string, value: string) {
    setValues({ ...values, [key]: value });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updates = config
        .filter((c) => values[c.key] !== c.value)
        .map((c) => ({ key: c.key, value: values[c.key] }));

      if (updates.length > 0) {
        await updateMultipleConfigs(updates);
      }
      toast.success("Settings saved");
      setDirty(false);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        {dirty && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      <Tabs defaultValue={categories[0] || "general"}>
        <TabsList className="mb-4">
          {categories.map((cat) => {
            const Icon = categoryIcons[cat] || Settings;
            return (
              <TabsTrigger key={cat} value={cat} className="gap-2">
                <Icon className="h-4 w-4" />
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        {categories.map((cat) => (
          <TabsContent key={cat} value={cat}>
            <div className="rounded-2xl border bg-card p-6 space-y-6">
              <h2 className="text-lg font-semibold capitalize">{cat} Settings</h2>
              {config
                .filter((c) => c.category === cat)
                .map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    value={values[item.key]}
                    onChange={(v) => handleChange(item.key, v)}
                  />
                ))}
            </div>
          </TabsContent>
        ))}

        <TabsContent value="whatsapp">
          <WhatsAppSetupWizard
            whatsappState={whatsappState}
            botUrl={config.find((c) => c.key === "whatsapp_bot_url")?.value || ""}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
