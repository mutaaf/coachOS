"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AccessCard } from "@/components/access-card";
import type { Person } from "@/lib/actions/access";
import { KeyRound } from "lucide-react";
import { updateMultipleConfigs } from "@/lib/actions/config";
import { checkStripeConnection, setStripeMode } from "@/lib/actions/stripe-mode";
import { toast } from "sonner";
import { Settings, MessageSquare, CreditCard, Calendar, Eye, EyeOff, Mail, ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { ZelleSetupSteps } from "@/components/zelle-setup";
import { toWhatsAppDigits } from "@/lib/outbox";
import { useRouter } from "next/navigation";
import type { Config } from "@/types/database";

interface SettingsPageClientProps {
  config: Config[];
  people: Person[];
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
          <Label className="text-sm" htmlFor={`cfg-${item.key}`}>{item.label}</Label>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <Input
            id={`cfg-${item.key}`}
            type="number"
            min={item.key === "payment_due_day" ? 1 : 0}
            max={item.key === "payment_due_day" ? 28 : undefined}
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
            : item.field_type === "phone" && toWhatsAppDigits(v)
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

const STRIPE_KEYS = new Set([
  "stripe_enabled",
  "stripe_mode",
  "stripe_test_secret_key",
  "stripe_test_webhook_secret",
  "stripe_live_secret_key",
  "stripe_live_webhook_secret",
]);

type CheckResult = { ok: boolean; text: string } | null;

/**
 * Stripe's sandbox and live mode side by side, and the switch between them.
 *
 * Checks and switching use the saved keys, so a key is saved before it is
 * tested. Going live is a deliberate act: it asks for confirmation, refuses
 * unless the live keys check out with Stripe, and says how many families need
 * to set autopay up again.
 */
function StripeCard({
  config,
  values,
  onChange,
  dirty,
}: {
  config: Config[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  dirty: boolean;
}) {
  const router = useRouter();
  const savedMode = config.find((c) => c.key === "stripe_mode")?.value === "live" ? "live" : "test";
  const [checks, setChecks] = useState<Record<"test" | "live", CheckResult>>({ test: null, live: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const item = (key: string) => config.find((c) => c.key === key);

  async function check(mode: "test" | "live") {
    setBusy(`check-${mode}`);
    const r = await checkStripeConnection(mode);
    setChecks((c) => ({
      ...c,
      [mode]:
        "error" in r && r.error
          ? { ok: false, text: r.error }
          : {
              ok: true,
              text: `Connected to ${(r as any).account} · ${mode} mode${(r as any).chargesEnabled ? "" : " · charges not enabled yet"}${(r as any).webhookSaved ? "" : " · webhook secret missing"}`,
            },
    }));
    setBusy(null);
  }

  async function switchTo(mode: "test" | "live") {
    if (dirty) {
      toast.error("Save your changes first, then switch.");
      return;
    }
    const warning =
      mode === "live"
        ? "Switch to LIVE? Real cards and bank accounts will be charged from now on.\n\nFamilies who set up autopay in test mode will be turned off and need to set it up again from their payment page."
        : "Switch back to TEST mode? No real money will move.\n\nFamilies who set up autopay in live mode will be turned off and need to set it up again.";
    if (!window.confirm(warning)) return;
    setBusy(`switch-${mode}`);
    const r = await setStripeMode(mode);
    setBusy(null);
    if ("error" in r && r.error) {
      toast.error("Not switched", { description: r.error });
      return;
    }
    const off = (r as any).autopayTurnedOff as number;
    toast.success(`Now in ${mode} mode — ${(r as any).account}`, {
      description: off ? `${off} ${off === 1 ? "family needs" : "families need"} to set up autopay again.` : undefined,
    });
    router.refresh();
  }

  const enabled = item("stripe_enabled");

  return (
    <div className="rounded-2xl border bg-card p-6" data-testid="stripe-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Card &amp; bank payments (Stripe)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Test mode uses Stripe&apos;s sandbox — nothing real is charged. Switch to live once everything has been
            tested; you can switch back any time.
          </p>
        </div>
        <span
          data-testid="stripe-mode"
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
            savedMode === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {savedMode === "live" ? "Live — real money" : "Test mode"}
        </span>
      </div>

      {enabled && (
        <div className="mt-5">
          <ConfigField item={enabled} value={values.stripe_enabled} onChange={(v) => onChange("stripe_enabled", v)} />
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {(["test", "live"] as const).map((mode) => (
          <div
            key={mode}
            className={`rounded-xl border p-4 ${savedMode === mode ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{mode === "test" ? "Test (sandbox)" : "Live"}</h3>
              {savedMode === mode && <span className="text-xs font-medium text-primary">In use</span>}
            </div>
            <div className="mt-3 space-y-4">
              {[`stripe_${mode}_secret_key`, `stripe_${mode}_webhook_secret`].map((key) => {
                const it = item(key);
                return it ? <SecretField key={key} item={it} value={values[key] ?? ""} onChange={(v) => onChange(key, v)} /> : null;
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-10" disabled={busy !== null} onClick={() => check(mode)}>
                {busy === `check-${mode}` ? "Checking…" : "Check connection"}
              </Button>
              {savedMode !== mode && (
                <Button
                  size="sm"
                  className="h-10"
                  variant={mode === "live" ? "default" : "outline"}
                  disabled={busy !== null}
                  onClick={() => switchTo(mode)}
                >
                  {busy === `switch-${mode}` ? "Switching…" : mode === "live" ? "Switch to live" : "Switch to test"}
                </Button>
              )}
            </div>
            {checks[mode] && (
              <p
                data-testid={`stripe-check-${mode}`}
                className={`mt-3 text-sm ${checks[mode]!.ok ? "text-emerald-700" : "text-red-700"}`}
              >
                {checks[mode]!.ok ? "✓ " : "✗ "}
                {checks[mode]!.text}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Both modes send webhooks to {origin}/api/webhooks/stripe —
        create the webhook in each mode in Stripe and paste its signing secret here. Save before checking or switching.
      </p>
    </div>
  );
}

export function SettingsPageClient({ config, people }: SettingsPageClientProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(config.map((c) => [c.key, c.value]))
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const categories = [...new Set(config.map((c) => c.category))].filter((c) => c !== "internal");
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
          <TabsTrigger value="access" className="gap-2" data-tour="access-tab">
            <KeyRound className="h-4 w-4" />
            Access
          </TabsTrigger>
        </TabsList>
        <TabsContent value="access">
          <AccessCard people={people} />
        </TabsContent>

        {categories.map((cat) => (
          <TabsContent key={cat} value={cat}>
            <div className="rounded-2xl border bg-card p-6 space-y-6">
              <h2 className="text-lg font-semibold capitalize">{cat} Settings</h2>
              {config
                .filter((c) => c.category === cat && !STRIPE_KEYS.has(c.key))
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
              <div className="mt-4">
                <StripeCard config={config} values={values} onChange={handleChange} dirty={dirty} />
              </div>
            )}
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
