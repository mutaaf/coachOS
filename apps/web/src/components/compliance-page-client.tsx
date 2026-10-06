"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Download, FileWarning, ShieldCheck, Trash2, Clock, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoachClearanceBadge } from "@/components/coach-clearance-badge";
import { useAction } from "@/lib/use-action";
import {
  applyPrivacyOptOut,
  eraseFamily,
  exportFamilyData,
  extendPrivacyDeadline,
  linkPrivacyFamily,
  updatePrivacyStatus,
} from "@/lib/actions/privacy";
import { createIncident, recordReturnToPlay, setIncidentStatus } from "@/lib/actions/incidents";
import { previewRetention } from "@/lib/actions/retention";
import { deadline, NEXT_STATUSES, REQUEST_TYPE_LABEL, STATUS_LABEL } from "@/lib/privacy";
import { formatBusinessTime, formatDateOnly } from "@/lib/dates";
import { familyHref } from "@/lib/family-link";
import type { CoachClearanceRow, IncidentRow, PrivacyRequestRow } from "@/lib/queries/compliance";
import type { PrivacyStatus } from "@/types/database";
import type { RetentionResult } from "@/lib/retention";
import type { StaffRole } from "@/lib/admin";
import type { PolicyFactsData } from "@/lib/queries/audit-compliance";
import type { AuditEntry, AuditFilters } from "@/lib/audit-kinds";
import type { ChecklistTask } from "@/lib/compliance-checklist";
import { PolicyFactsPanel } from "@/components/policy-facts-panel";
import { ComplianceChecklistPanel } from "@/components/compliance-checklist-panel";
import { AuditLogPanel } from "@/components/audit-log-panel";

type Pickers = {
  students: { id: string; first_name: string; last_name: string }[];
  programs: { id: string; name: string }[];
  parents: { id: string; first_name: string; last_name: string; phone: string; email: string | null }[];
  coaches: { id: string; first_name: string; last_name: string }[];
};

const deadlineStyle = { overdue: "destructive", soon: "warning", ok: "secondary", closed: "secondary" } as const;

/** A short text the Boss has to give: a reason, how she checked it was them. */
function AskDialog({
  ask,
  onClose,
}: {
  ask: { title: string; label: string; hint?: string; confirmWord?: string; run: (value: string) => Promise<boolean> } | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!ask) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-md">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{ask.title}</DialogTitle>
        </DialogHeader>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await ask.run(value);
            setBusy(false);
            if (ok) {
              setValue("");
              onClose();
            }
          }}
        >
          <Label htmlFor="ask-value">{ask.label}</Label>
          {ask.confirmWord ? (
            <Input id="ask-value" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          ) : (
            <Textarea id="ask-value" rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {ask.hint && <p className="text-xs text-muted-foreground">{ask.hint}</p>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-11 sm:h-10"
              disabled={busy || (ask.confirmWord ? value !== ask.confirmWord : !value.trim())}
              variant={ask.confirmWord ? "destructive" : "default"}
            >
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function download(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PrivacyRequests({ requests, parents }: { requests: PrivacyRequestRow[]; parents: Pickers["parents"] }) {
  const { run, pending } = useAction();
  const [ask, setAsk] = useState<Parameters<typeof AskDialog>[0]["ask"]>(null);
  const open = requests.filter((r) => deadline({ privacy_status: r.privacy_status!, due_at: r.due_at ?? null, appeal_due_at: r.appeal_due_at }).state !== "closed");

  const move = (id: string, to: PrivacyStatus, details: Parameters<typeof updatePrivacyStatus>[2] = {}) =>
    run(() => updatePrivacyStatus(id, to, details), { success: STATUS_LABEL[to], error: "Not saved" });

  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No privacy requests. When a parent asks on the website to see, correct or delete their data, it appears here with
        its deadline.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {open.length} open. Texas law gives 45 days to answer (once extendable by 45, telling the parent why) and 60 days
        to decide an appeal. Check it&apos;s really them before sending or deleting anything.
      </p>
      {requests.map((r) => {
        const d = deadline({ privacy_status: r.privacy_status!, due_at: r.due_at ?? null, appeal_due_at: r.appeal_due_at });
        const status = r.privacy_status!;
        const next = NEXT_STATUSES[status];
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "Someone";
        return (
          <div key={r.id} data-testid="privacy-request" className="rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{name}</span>
              <Badge variant="secondary">{REQUEST_TYPE_LABEL[r.request_type!]}</Badge>
              <Badge variant={status === "completed" || status === "appeal_granted" ? "success" : "outline"}>{STATUS_LABEL[status]}</Badge>
              {d.state !== "closed" && d.dueAt && (
                <Badge variant={deadlineStyle[d.state]} data-testid="privacy-deadline">
                  <Clock className="mr-1 h-3 w-3" />
                  {d.state === "overdue" ? `${-d.daysLeft!} days overdue` : `${d.daysLeft} days left`} · due{" "}
                  {formatBusinessTime(d.dueAt)}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-muted-foreground">
              Received {formatBusinessTime(r.created_at)}
              {r.phone && <> · {r.phone}</>}
              {r.email && <> · {r.email}</>}
              {r.child_first_names && r.child_first_names.length > 0 && <> · children: {r.child_first_names.join(", ")}</>}
              {r.extended_at && <> · extended ({r.extension_reason})</>}
            </p>
            {r.message && <p className="mt-1 whitespace-pre-wrap break-words">{r.message}</p>}
            {r.denial_reason && <p className="mt-1 text-red-700">Declined: {r.denial_reason}</p>}
            {r.appeal_decision && <p className="mt-1">Appeal: {r.appeal_decision}</p>}
            {r.resolution_note && <p className="mt-1 text-muted-foreground">{r.resolution_note}</p>}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.family ? (
                <span>
                  Family:{" "}
                  {r.family.anonymized_at ? (
                    <span className="text-muted-foreground">erased</span>
                  ) : (
                    <Link className="underline" href={familyHref(r.family.id)}>
                      {r.family.first_name} {r.family.last_name}
                    </Link>
                  )}
                </span>
              ) : (
                <div className="w-full sm:w-80">
                  <Select
                    aria-label="Which family is this?"
                    options={[
                      { value: "", label: "Which family is this?" },
                      ...parents.map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name} · ${p.phone}` })),
                    ]}
                    defaultValue=""
                    disabled={pending}
                    onChange={(e) =>
                      e.target.value &&
                      run(() => linkPrivacyFamily(r.id, e.target.value), { success: "Family linked", error: "Not linked" })
                    }
                  />
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              {next.includes("verifying") && (
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => setAsk({
                    title: "How did you check it's them?",
                    label: "e.g. called the phone number on file and confirmed the children's names",
                    run: (v) => move(r.id, "verifying", { verificationMethod: v }),
                  })}>
                  Start checking it&apos;s them
                </Button>
              )}
              {r.family && !r.family.anonymized_at && r.request_type !== "opt_out" && (status === "verifying" || status === "appealed") && (
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                  onClick={async () => {
                    const result = await exportFamilyData(r.family!.id, r.id);
                    if ("json" in result && result.json) download(result.json, result.filename);
                  }}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Download their data
                </Button>
              )}
              {r.request_type === "opt_out" && r.family && status === "verifying" && (
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => run(() => applyPrivacyOptOut(r.id), { success: "Marketing stopped for this family", error: "Not saved" })}>
                  Stop marketing to them
                </Button>
              )}
              {(r.request_type === "delete" || status === "appealed") && r.family && !r.family.anonymized_at && (status === "verifying" || status === "appealed") && (
                <Button size="sm" variant="destructive" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => setAsk({
                    title: "Erase this family?",
                    label: "Type ERASE to confirm",
                    confirmWord: "ERASE",
                    hint: "Names, phone, email, dates of birth, medical notes and messages are removed for good. Invoice and payment amounts and dates stay for tax records. Incident reports are kept while a claim could be brought. Children must be withdrawn first.",
                    run: (v) => run(() => eraseFamily(r.family!.id, r.id, v), { success: "Family erased", error: "Not erased" }),
                  })}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Erase family
                </Button>
              )}
              {next.includes("completed") && (
                <Button size="sm" className="h-11 sm:h-9" disabled={pending} onClick={() => move(r.id, "completed")}>
                  Mark done
                </Button>
              )}
              {next.includes("denied") && (
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => setAsk({
                    title: "Decline the request",
                    label: "Why? The parent must be told, with how to appeal.",
                    run: (v) => move(r.id, "denied", { reason: v }),
                  })}>
                  Decline…
                </Button>
              )}
              {next.includes("appealed") && (
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => move(r.id, "appealed")}>
                  They appealed
                </Button>
              )}
              {next.includes("appeal_granted") && (
                <>
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => setAsk({ title: "Uphold the appeal", label: "What you'll do now", run: (v) => move(r.id, "appeal_granted", { reason: v }) })}>
                    Uphold appeal
                  </Button>
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => setAsk({
                      title: "Decline the appeal",
                      label: "Why? In writing to the parent.",
                      hint: "Tell them they can complain to the Texas Attorney General: texasattorneygeneral.gov/consumer-protection.",
                      run: (v) => move(r.id, "appeal_denied", { reason: v }),
                    })}>
                    Decline appeal
                  </Button>
                </>
              )}
              {(status === "received" || status === "verifying") && !r.extended_at && (
                <Button size="sm" variant="ghost" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => setAsk({
                    title: "Take 45 more days",
                    label: "Why more time is needed (tell the parent this before the first 45 days run out)",
                    run: (v) => run(() => extendPrivacyDeadline(r.id, v), { success: "Deadline extended", error: "Not extended" }),
                  })}>
                  Extend 45 days
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

function IncidentForm({ pickers, onDone }: { pickers: Pickers; onDone: () => void }) {
  const { run, pending } = useAction();
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => createIncident(new FormData(e.currentTarget)), { success: "Incident recorded", error: "Not recorded" });
        if (ok) onDone();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="occurred_at">When</Label>
          <Input id="occurred_at" name="occurred_at" type="datetime-local" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="kind">What kind</Label>
          <Select id="kind" name="kind" defaultValue="injury" options={[
            { value: "injury", label: "Injury" },
            { value: "illness", label: "Illness" },
            { value: "behavior", label: "Behaviour" },
            { value: "safeguarding", label: "Safeguarding concern" },
            { value: "other", label: "Other" },
          ]} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="student_id">Child</Label>
          <Select id="student_id" name="student_id" defaultValue="" options={[{ value: "", label: "—" }, ...pickers.students.map((s) => ({ value: s.id, label: `${s.first_name} ${s.last_name}` }))]} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="program_id">Program</Label>
          <Select id="program_id" name="program_id" defaultValue="" options={[{ value: "", label: "—" }, ...pickers.programs.map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="coach_id">Coach there</Label>
          <Select id="coach_id" name="coach_id" defaultValue="" options={[{ value: "", label: "—" }, ...pickers.coaches.map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }))]} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">What happened</Label>
        <Textarea id="description" name="description" rows={3} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="actions_taken">What was done</Label>
        <Textarea id="actions_taken" name="actions_taken" rows={2} placeholder="First aid, ice, called parent, 911…" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="parent_notified_at">Parent told at</Label>
          <Input id="parent_notified_at" name="parent_notified_at" type="datetime-local" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="parent_notified_how">How</Label>
          <Input id="parent_notified_how" name="parent_notified_how" placeholder="Phone call, in person at pickup…" />
        </div>
      </div>
      <label className="flex min-h-11 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <input type="checkbox" name="concussion_suspected" className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          <strong>Possible concussion</strong> (a knock to the head, with any sign or symptom). They sit out every practice
          until a doctor clears them in writing — CoachOS won&apos;t let them be marked here until you record it.
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="reported_to_authorities_at">Reported to DFPS / police at</Label>
          <Input id="reported_to_authorities_at" name="reported_to_authorities_at" type="datetime-local" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="authority_reference">Report reference</Label>
          <Input id="authority_reference" name="authority_reference" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={pending}>{pending ? "Saving..." : "Record"}</Button>
      </div>
    </form>
  );
}

function Incidents({ incidents, pickers }: { incidents: IncidentRow[]; pickers: Pickers }) {
  const { run, pending } = useAction();
  const [reporting, setReporting] = useState(false);
  const [clearing, setClearing] = useState<IncidentRow | null>(null);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">If you suspect a child is being abused or neglected, report it now.</p>
        <p className="mt-1">
          Texas law requires anyone who suspects it to report immediately — it can&apos;t be passed to someone else. Call
          the Texas Abuse Hotline <a className="underline" href="tel:+18002525400">1-800-252-5400</a> or report at{" "}
          <a className="underline" href="https://www.txabusehotline.org" target="_blank" rel="noreferrer">txabusehotline.org</a>.
          If a child is in immediate danger, call 911. Then record it here.
        </p>
      </div>

      <Button className="h-11 w-full sm:h-10 sm:w-auto" onClick={() => setReporting(true)}>
        <FileWarning className="mr-1 h-4 w-4" /> Report an incident
      </Button>

      {incidents.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No incidents recorded.</p>
      ) : (
        incidents.map((i) => {
          const hold = i.concussion_suspected && !i.cleared_to_return_at;
          return (
            <div key={i.id} data-testid="incident" className="rounded-xl border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium capitalize">{i.kind}</span>
                {i.student && <span>{i.student.first_name} {i.student.last_name}</span>}
                {i.program && <span className="text-muted-foreground">· {i.program.name}</span>}
                <span className="text-muted-foreground">· {formatBusinessTime(i.occurred_at)}</span>
                <Badge variant={i.status === "open" ? "warning" : "secondary"}>{i.status}</Badge>
                {hold && (
                  <Badge variant="destructive" data-testid="return-to-play-hold">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Sitting out until cleared
                  </Badge>
                )}
                {i.concussion_suspected && i.cleared_to_return_at && (
                  <Badge variant="success">Cleared {formatBusinessTime(i.cleared_to_return_at)} by {i.clearance_provider}</Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{i.description}</p>
              {i.actions_taken && <p className="mt-1 text-muted-foreground">Done: {i.actions_taken}</p>}
              <p className={`mt-1 ${i.parent_notified_at ? "text-muted-foreground" : "font-medium text-red-700"}`}>
                {i.parent_notified_at
                  ? `Parent told ${formatBusinessTime(i.parent_notified_at)}${i.parent_notified_how ? ` (${i.parent_notified_how})` : ""}`
                  : "Parent not told yet"}
              </p>
              {i.kind === "safeguarding" && (
                <p className={`mt-1 ${i.reported_to_authorities_at ? "text-muted-foreground" : "font-medium text-red-700"}`}>
                  {i.reported_to_authorities_at
                    ? `Reported ${formatBusinessTime(i.reported_to_authorities_at)}${i.authority_reference ? ` · ref ${i.authority_reference}` : ""}`
                    : "Not yet reported to DFPS / police"}
                </p>
              )}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
                {hold && (
                  <Button size="sm" className="h-11 sm:h-9" disabled={pending} onClick={() => setClearing(i)}>
                    Record doctor&apos;s clearance
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                  onClick={() => run(() => setIncidentStatus(i.id, i.status === "open" ? "closed" : "open"), { success: "Saved" })}>
                  {i.status === "open" ? "Close" : "Reopen"}
                </Button>
              </div>
            </div>
          );
        })
      )}

      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent onClose={() => setReporting(false)} className="max-w-xl">
          <DialogHeader className="pr-8 text-left"><DialogTitle>Report an incident</DialogTitle></DialogHeader>
          <IncidentForm pickers={pickers} onDone={() => setReporting(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!clearing} onOpenChange={(o) => !o && setClearing(null)}>
        <DialogContent onClose={() => setClearing(null)} className="max-w-md">
          <DialogHeader className="pr-8 text-left"><DialogTitle>Written clearance to return</DialogTitle></DialogHeader>
          <form
            className="mt-3 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => recordReturnToPlay(clearing!.id, new FormData(e.currentTarget)), {
                success: "Cleared to play",
                error: "Not saved",
              });
              if (ok) setClearing(null);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="clearance_provider">Signed by (doctor or licensed provider)</Label>
              <Input id="clearance_provider" name="clearance_provider" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cleared_to_return_at">Dated</Label>
              <Input id="cleared_to_return_at" name="cleared_to_return_at" type="datetime-local" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clearance_note">Note</Label>
              <Textarea id="clearance_note" name="clearance_note" rows={2} placeholder="Where the signed note is kept" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => setClearing(null)}>Cancel</Button>
              <Button type="submit" className="h-11 sm:h-10" disabled={pending}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffClearance({ coaches }: { coaches: CoachClearanceRow[] }) {
  const notCleared = coaches.filter((c) => c.clearance.status === "not_cleared");
  const expiring = coaches.filter((c) => c.clearance.status === "expiring");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Not cleared</p><p className="text-2xl font-semibold tabular-nums text-red-700">{notCleared.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Renewal due</p><p className="text-2xl font-semibold tabular-nums text-orange-700">{expiring.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Cleared</p><p className="text-2xl font-semibold tabular-nums text-green-700">{coaches.length - notCleared.length - expiring.length}</p></div>
      </div>
      {coaches.map((c) => (
        <div key={c.id} data-testid="clearance-row" className="rounded-xl border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground capitalize">{c.status}</span>
            <CoachClearanceBadge clearance={c.clearance} />
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {c.clearance.items.map((i) => (
              <li key={i.key} className={i.state === "ok" ? "text-muted-foreground" : i.state === "expiring" ? "text-orange-700" : "text-red-700"}>
                {i.label}: {i.state === "missing" ? "missing" : i.state === "expired" ? "expired" : i.state === "expiring" ? "expiring" : "ok"}
                {i.expiresOn && i.state !== "missing" && ` (until ${formatDateOnly(i.expiresOn)})`}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Link href="/coaches" className="inline-flex min-h-11 items-center text-sm underline">
        Update a coach&apos;s checks on the Coaches page
      </Link>
    </div>
  );
}

function DataKeeping({ retention }: { retention: Record<string, number> }) {
  const [counts, setCounts] = useState<RetentionResult | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl border bg-card p-4">
        <p className="font-semibold">How long we keep things</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Website questions: contact details removed after {retention.inquiryMonths} months.</li>
          <li>Registrations that never became a place (declined, cancelled, waitlist): removed after {retention.registrationMonths} months.</li>
          <li>A child&apos;s medical note: removed {retention.medicalNoteMonths} months after their last active place.</li>
          <li>Closed privacy requests: requester&apos;s contact removed after {retention.privacyRequestMonths} months; the record stays.</li>
          <li>Kept: invoices and payments (tax records), incident reports (while a claim could be brought), the audit log.</li>
        </ul>
        <p className="mt-2 text-muted-foreground">This runs every night. Until it&apos;s switched on it only counts.</p>
      </div>
      <Button variant="outline" className="h-11 sm:h-10" disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await previewRetention();
          setBusy(false);
          if ("result" in r && r.result) setCounts(r.result);
        }}>
        {busy ? "Counting..." : "What would tonight's clean-up remove?"}
      </Button>
      {counts && (
        <p data-testid="retention-counts">
          {counts.inquiries} questions · {counts.registrations} registrations · {counts.medical_notes} medical notes ·{" "}
          {counts.privacy_requests} old privacy requests
        </p>
      )}
    </div>
  );
}

type AdminData = {
  requests: PrivacyRequestRow[];
  incidents: IncidentRow[];
  coaches: CoachClearanceRow[];
  pickers: Pickers;
  retention: Record<string, number>;
};

const ADMIN_TABS = ["privacy", "coaches", "incidents", "data"];

export function CompliancePageClient({
  role,
  today,
  facts,
  checklist,
  audit,
  auditFilters,
  admin,
  initialTab,
}: {
  role: StaffRole;
  today: string;
  facts: PolicyFactsData;
  checklist: ChecklistTask[];
  audit: AuditEntry[];
  auditFilters: AuditFilters;
  /** Families' data: only ever fetched for an admin. */
  admin: AdminData | null;
  initialTab?: string;
}) {
  const requests = admin?.requests ?? [];
  const incidents = admin?.incidents ?? [];
  const coaches = admin?.coaches ?? [];
  const overdue = requests.filter(
    (r) => deadline({ privacy_status: r.privacy_status!, due_at: r.due_at ?? null, appeal_due_at: r.appeal_due_at }).state === "overdue"
  ).length;
  const openRequests = requests.filter(
    (r) => deadline({ privacy_status: r.privacy_status!, due_at: r.due_at ?? null, appeal_due_at: r.appeal_due_at }).state !== "closed"
  ).length;
  const holds = incidents.filter((i) => i.concussion_suspected && !i.cleared_to_return_at).length;
  const notCleared = coaches.filter((c) => c.clearance.status === "not_cleared" && c.status === "active").length;
  const tab = initialTab && (admin || !ADMIN_TABS.includes(initialTab)) ? initialTab : "facts";
  const factLabels = Object.fromEntries(facts.facts.map((f) => [f.key, f.label]));
  const hints: Record<string, string> = admin
    ? {
        "privacy-requests-due": `${openRequests} open privacy request${openRequests === 1 ? "" : "s"}${overdue ? `, ${overdue} past the deadline` : ""}.`,
        "coach-clearance-review": `${notCleared} active coach${notCleared === 1 ? "" : "es"} not cleared.`,
      }
    : {};

  return (
    <div className="space-y-6 pb-4">
      <div className="flex min-w-0 items-start gap-3">
        <ShieldCheck className="mt-1.5 hidden h-6 w-6 shrink-0 text-muted-foreground sm:block" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Audit &amp; Compliance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {admin
              ? "The facts behind the website's policies, the recurring compliance checklist, families' privacy requests, incident reports, coach clearance, and a record of every change."
              : "The facts behind the website's policies, the recurring compliance checklist, and a record of every change."}
          </p>
        </div>
      </div>

      {(overdue > 0 || holds > 0 || notCleared > 0) && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {overdue > 0 && <p>{overdue} privacy request{overdue === 1 ? " is" : "s are"} past the legal deadline.</p>}
          {holds > 0 && <p>{holds} child{holds === 1 ? " is" : "ren are"} sitting out until a doctor&apos;s clearance is recorded.</p>}
          {notCleared > 0 && <p>{notCleared} active coach{notCleared === 1 ? " isn't" : "es aren't"} cleared to work with children.</p>}
        </div>
      )}

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="facts">Policy facts</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          {admin && <TabsTrigger value="privacy">Privacy requests</TabsTrigger>}
          {admin && <TabsTrigger value="coaches">Coach clearance</TabsTrigger>}
          {admin && <TabsTrigger value="incidents">Incidents</TabsTrigger>}
          {admin && <TabsTrigger value="data">Data kept</TabsTrigger>}
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="facts"><PolicyFactsPanel data={facts} role={role} today={today} /></TabsContent>
        <TabsContent value="checklist"><ComplianceChecklistPanel tasks={checklist} today={today} hints={hints} /></TabsContent>
        {admin && <TabsContent value="privacy"><PrivacyRequests requests={admin.requests} parents={admin.pickers.parents} /></TabsContent>}
        {admin && <TabsContent value="coaches"><StaffClearance coaches={admin.coaches} /></TabsContent>}
        {admin && <TabsContent value="incidents"><Incidents incidents={admin.incidents} pickers={admin.pickers} /></TabsContent>}
        {admin && <TabsContent value="data"><DataKeeping retention={admin.retention} /></TabsContent>}
        <TabsContent value="audit"><AuditLogPanel entries={audit} filters={auditFilters} role={role} factLabels={factLabels} /></TabsContent>
      </Tabs>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Phone className="h-3 w-3" /> Not legal advice. The policies behind this page should be reviewed by a Texas attorney (docs/COMPLIANCE.md).
      </p>
    </div>
  );
}
