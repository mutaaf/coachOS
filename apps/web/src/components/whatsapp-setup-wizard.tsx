"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Wifi,
  WifiOff,
  QrCode,
  Rocket,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateConfig } from "@/lib/actions/config";
import { toast } from "sonner";
import type { WhatsAppState } from "@/types/database";

interface WhatsAppSetupWizardProps {
  whatsappState: WhatsAppState | null;
  botUrl: string;
}

type Step = 1 | 2 | 3 | 4;

function detectStep(whatsappState: WhatsAppState | null, botUrl: string): Step {
  if (whatsappState?.status === "connected") return 4;
  if (whatsappState?.status === "qr_ready") return 3;
  if (botUrl) return 2;
  return 1;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function WhatsAppSetupWizard({ whatsappState: initialState, botUrl: initialBotUrl }: WhatsAppSetupWizardProps) {
  const [whatsappState, setWhatsappState] = useState(initialState);
  const [botUrl, setBotUrl] = useState(initialBotUrl);
  const [urlInput, setUrlInput] = useState(initialBotUrl);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentStep = detectStep(whatsappState, botUrl);

  // Poll whatsapp_state every 3 seconds during steps 2-3
  const pollState = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("whatsapp_state")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (data) {
      setWhatsappState(data);
    }
  }, []);

  useEffect(() => {
    if (currentStep === 2 || currentStep === 3) {
      const interval = setInterval(pollState, 3000);
      return () => clearInterval(interval);
    }
  }, [currentStep, pollState]);

  async function handleTestConnection() {
    const url = urlInput.trim().replace(/\/+$/, "");
    if (!url) {
      toast.error("Please enter a URL.");
      return;
    }

    setTesting(true);
    try {
      // Use server-side proxy to avoid CORS issues
      const res = await fetch("/api/bot-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Bot responded with an error. Check the URL and try again.");
        return;
      }
      if (data.status === "connected" || data.status === "running") {
        setSaving(true);
        await updateConfig("whatsapp_bot_url", url);
        setBotUrl(url);
        toast.success("Connected to WhatsApp bot successfully!");
      } else {
        toast.error("Unexpected response from bot. Check the URL.");
      }
    } catch {
      toast.error("Could not reach the bot. Make sure it's deployed and the URL is correct.");
    } finally {
      setTesting(false);
      setSaving(false);
    }
  }

  const steps = [
    { num: 1, label: "Deploy" },
    { num: 2, label: "Connect" },
    { num: 3, label: "Scan QR" },
    { num: 4, label: "Ready" },
  ];

  return (
    <div className="rounded-2xl border bg-card p-6 space-y-6">
      <h2 className="text-lg font-semibold">WhatsApp Setup</h2>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step.num} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step.num < currentStep
                  ? "bg-green-100 text-green-700"
                  : step.num === currentStep
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step.num < currentStep ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                step.num
              )}
            </div>
            <span
              className={`text-sm ${
                step.num === currentStep ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`h-px w-8 ${step.num < currentStep ? "bg-green-300" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Deploy */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Rocket className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="font-medium text-blue-900">Deploy your WhatsApp bot</p>
                <p className="text-sm text-blue-700">
                  Railway is a cloud service that runs your WhatsApp bot 24/7 so messages send
                  automatically. It costs about $5/month.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <p className="text-sm font-medium">Quick setup steps:</p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-2">
              <li>
                Go to <a href="https://railway.app" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">railway.app</a> and sign in with GitHub
              </li>
              <li>
                Click <strong>New Project</strong> → <strong>Deploy from GitHub repo</strong> → select your CoachOS repo
              </li>
              <li>
                In the service settings, set <strong>Root Directory</strong> to: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">apps/whatsapp-bot</code> <CopyButton text="apps/whatsapp-bot" />
              </li>
              <li>
                Add these environment variables in the <strong>Variables</strong> tab:
                <div className="mt-2 space-y-1.5 ml-4">
                  <div className="flex items-center gap-2">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">SUPABASE_URL</code>
                    <span className="text-xs">— your Supabase project URL</span>
                    <CopyButton text="SUPABASE_URL" />
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">SUPABASE_SERVICE_ROLE_KEY</code>
                    <span className="text-xs">— from Supabase Settings → API</span>
                    <CopyButton text="SUPABASE_SERVICE_ROLE_KEY" />
                  </div>
                </div>
              </li>
              <li>Click <strong>Deploy</strong> and wait 2-3 minutes for it to build</li>
              <li>Once deployed, copy the bot&apos;s public URL from Railway and paste it below</li>
            </ol>
          </div>

          <div className="rounded-xl border border-dashed p-4 space-y-3">
            <Label className="text-sm font-medium">Bot URL</Label>
            <p className="text-xs text-muted-foreground">
              Find this in Railway → your service → Settings → Networking → Public URL.
              It looks like <code className="bg-muted px-1 py-0.5 rounded">https://something.railway.app</code>
            </p>
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://your-bot.railway.app"
              />
              <Button
                onClick={handleTestConnection}
                disabled={testing || saving || !urlInput.trim()}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Test & Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Connect */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <WifiOff className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-amber-900">Bot deployed — waiting for WhatsApp connection</p>
                <p className="text-sm text-amber-700">
                  Your bot is running but hasn&apos;t connected to WhatsApp yet. A QR code will appear
                  automatically once the bot is ready — this usually takes 1-2 minutes after deploy.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Bot URL</Label>
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://your-bot.railway.app"
              />
              <Button
                onClick={handleTestConnection}
                disabled={testing || saving}
              >
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for QR code...
          </div>
        </div>
      )}

      {/* Step 3: Scan QR */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
              <QrCode className="h-4 w-4" />
              Scan this QR code with WhatsApp
            </div>

            {whatsappState?.qr_code && (
              <div className="bg-white p-6 rounded-2xl inline-block border shadow-sm">
                <img
                  src={`data:image/png;base64,${whatsappState.qr_code}`}
                  alt="QR Code"
                  className="w-56 h-56"
                />
              </div>
            )}

            <div className="max-w-sm mx-auto space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How to scan:</p>
              <ol className="list-decimal list-inside space-y-1 text-left">
                <li>Open WhatsApp on your phone</li>
                <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong></li>
                <li>Point your camera at this QR code</li>
              </ol>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for scan...
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Connected */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-green-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                <Wifi className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-green-900">WhatsApp Connected</div>
                <div className="text-sm text-green-700">
                  {whatsappState?.phone_number && `Phone: ${whatsappState.phone_number}`}
                  {whatsappState?.last_connected_at && (
                    <> · Since {new Date(whatsappState.last_connected_at).toLocaleDateString()}</>
                  )}
                </div>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Messages will be sent automatically through WhatsApp. You can manage message templates
            and queues from the Messaging page.
          </p>
        </div>
      )}
    </div>
  );
}
