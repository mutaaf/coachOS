"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { ExternalLink, Mail } from "lucide-react";

/**
 * Setting up Zelle matching, as steps with a button for each — open the right
 * Gmail, open Apps Script, copy the script — so nothing has to be typed or
 * selected. Every address in it comes from Settings.
 */

export function zelleScript(endpoint: string, key: string) {
  return `// Reports Zelle payment emails to CoachOS so they're recorded automatically.
// Press Run once, whichever function is selected: it sets itself up to check
// every 15 minutes from then on.
const ENDPOINT = "${endpoint}";
const KEY = "${key}";

function install() {
  reportZellePayments();
}

function reportZellePayments() {
  keepChecking();
  const threads = GmailApp.search("zelle newer_than:3d -in:sent");
  const messages = [];
  threads.forEach((t) =>
    t.getMessages().forEach((m) =>
      messages.push({
        id: m.getId(),
        subject: m.getSubject(),
        text: m.getPlainBody(),
        receivedAt: m.getDate().toISOString(),
      })
    )
  );
  // Posts even when there's nothing new, so CoachOS can tell the script is
  // still running.
  UrlFetchApp.fetch(ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + KEY },
    payload: JSON.stringify({ messages: messages.slice(0, 100) }),
  });
}

// The 15-minute timer. Created on the first run, whichever function was run,
// and never twice.
function keepChecking() {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.some((t) => t.getHandlerFunction() === "reportZellePayments")) return;
  triggers.forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("reportZellePayments").timeBased().everyMinutes(15).create();
}
`;
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
    >
      {children}
    </a>
  );
}

export function ZelleSetupSteps({
  secret,
  inbox,
  forwardFrom,
}: {
  secret: string;
  inbox: string;
  forwardFrom: string;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const endpoint = `${origin}/api/inbound/zelle`;
  const script = zelleScript(endpoint, secret);

  return (
    <div className="space-y-5 text-sm">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
        Do this once, on a computer — Google&apos;s script editor doesn&apos;t work on a phone. About 3 minutes.
        After that it runs by itself.
      </p>

      <ol className="space-y-4">
        <li>
          <p className="font-medium">1. Open Gmail as {inbox || "the Gmail your Zelle alerts reach"}</p>
          <p className="mt-0.5 text-muted-foreground">Signed in to that account — the script reads its inbox.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {inbox && (
              <LinkButton href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(inbox)}`}>
                <Mail className="h-4 w-4" /> Open Gmail
              </LinkButton>
            )}
            {inbox && <CopyButton value={inbox} label="Copy address" />}
          </div>
        </li>

        <li>
          <p className="font-medium">2. Open a new Apps Script project</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <LinkButton
              href={`https://script.google.com/home/projects/create${inbox ? `?authuser=${encodeURIComponent(inbox)}` : ""}`}
            >
              <ExternalLink className="h-4 w-4" /> Open Apps Script
            </LinkButton>
          </div>
        </li>

        <li>
          <p className="font-medium">3. Replace what&apos;s there with this script</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={script} label="Copy the script" size="md" className="bg-slate-900 text-white hover:bg-slate-800 [&_svg]:text-white" />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Show the script</summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
              {script}
            </pre>
          </details>
        </li>

        <li>
          <p className="font-medium">4. Press Run, then Allow</p>
          <p className="mt-0.5 text-muted-foreground">
            Google warns it hasn&apos;t verified the app — it&apos;s your own script. Click Advanced, then Go to the
            project, then Allow.
          </p>
        </li>

        {forwardFrom && (
          <li>
            <p className="font-medium">5. From now on, forward Zelle alerts from {forwardFrom}</p>
            <p className="mt-0.5 text-muted-foreground">
              Forward each one, unchanged, to {inbox || "the Gmail above"} — from your phone is fine. It&apos;s
              recorded within 15 minutes.
            </p>
            {inbox && (
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton value={inbox} label="Copy address to forward to" />
              </div>
            )}
          </li>
        )}
      </ol>

      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">For whoever sets this up</summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Endpoint</p>
            <div className="mt-1 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-2 text-xs">{endpoint}</code>
              <CopyButton value={endpoint} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Key (the Zelle Email Key setting; change it there to cut off an old script)</p>
            <div className="mt-1 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-2 text-xs">{"•".repeat(16)}</code>
              <CopyButton value={secret} />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
