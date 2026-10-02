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
import { Settings, MessageSquare, CreditCard, Calendar, Eye, EyeOff, Mail, ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { ZelleSetupSteps } from "@/components/zelle-setup";
import { useRouter } from "next/navigation";
import type { Config } from "@/types/database";

interface SettingsPageClientProps {
  config: Config[];
}

function toWhatsAppDigits(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
}

/** A key: hidden until asked for, copyable without being shown. */
function SecretField({ item, value, onChange }: { item: Config; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <Label className="text-sm" htmlFor={`cfg-${item.key}`}>{item.label}</Label>
      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
      <div className="flex gap-2">
        <Input
          id={`cfg-${item.key}`}
          type={shown ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 font-mono"
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? `Hide ${item.label}` : `Show ${item.label}`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white text-slate-600 hover:bg-slate-50"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <CopyButton value={value} />
      </div>
    </div>
  );
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
    case "secret":
      return <SecretField item={item} value={value} onChange={onChange} />;
    default: {
      // Text, email, link and phone: editable, copyable, and — where it means
      // something — openable, so an address can be used without retyping it.
      const v = (value ?? "").trim();
      const open =
        item.field_type === "email" && v.includes("@")
          ? { href: `mailto:${v}`, label: "Email", icon: Mail }
          : item.field_type === "url" && /^https?:\/\//.test(v)
            ? { href: v, label: "Open", icon: ExternalLink }
            : item.field_type === "phone" && v.replace(/\D/g, "").length >= 10
              ? { href: `https://wa.me/${toWhatsAppDigits(v)}`, label: "WhatsApp", icon: MessageSquare }
              : null;
      return (
        <div className="space-y-2">
          <Label className="text-sm" htmlFor={`cfg-${item.key}`}>{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <div className="flex gap-2">
            <Input
              id={`cfg-${item.key}`}
              type={item.field_type === "email" ? "email" : item.field_type === "phone" ? "tel" : "text"}
              inputMode={item.field_type === "phone" ? "tel" : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-10"
            />
            <CopyButton value={v} />
            {open && (
              <a
                href={open.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <open.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{open.label}</span>
              </a>
            )}
          </div>
        </div>
      );
    }
  }
}

export function SettingsPageClient({ config }: SettingsPageClientProps) {
  const router = useRouter();
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
    const updates = config
      .filter((c) => values[c.key] !== c.value)
      .map((c) => ({ key: c.key, value: values[c.key] }));
    const result = updates.length > 0 ? await updateMultipleConfigs(updates) : { success: true };
    setSaving(false);
    if (result && "error" in result && result.error) {
      toast.error("Settings weren't saved", { description: result.error });
      return;
    }
    toast.success("Saved — in effect now");
    setDirty(false);
    router.refresh();
  }

  return (
    <div>
      {dirty && (
        <div className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-lg lg:hidden">
          <span className="text-sm font-medium">Unsaved changes</span>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        {dirty && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      <Tabs defaultValue={categories[0] || "general"}>
        <TabsList className="mb-4" data-tour="settings-tabs">
          {categories.map((cat) => {
            const Icon = categoryIcons[cat] || Settings;
            return (
              <TabsTrigger key={cat} value={cat} className="gap-2">
                <Icon className="h-4 w-4" />
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </TabsTrigger>
            );
          })}
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
            {cat === "payments" && (
              <div className="mt-4 rounded-2xl border bg-card p-6">
                <h2 className="text-lg font-semibold">Zelle email setup</h2>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">
                  Uses the Zelle Alerts Gmail, Bank Alerts Arrive At and Zelle Email Key above — save any change first.
                </p>
                <ZelleSetupSteps
                  secret={values.zelle_inbound_secret ?? ""}
                  inbox={values.zelle_alerts_inbox ?? ""}
                  forwardFrom={values.zelle_alerts_forward_from ?? ""}
                />
              </div>
            )}
          </TabsContent>
        ))}

      </Tabs>
    </div>
  );
}
