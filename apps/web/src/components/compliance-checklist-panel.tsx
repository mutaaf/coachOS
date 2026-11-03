"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ExternalLink, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";
import { actorName } from "@/lib/legal-facts";
import { cadenceLabel, dueState, isInternalLink, type ChecklistTask } from "@/lib/compliance-checklist";
import { completeChecklistTask, updateChecklistTask } from "@/lib/actions/compliance-checklist";

const day = (iso: string) => formatDateOnly(iso, { month: "short", day: "numeric", year: "numeric" });

const DUE_STYLE = {
  overdue: "border-rose-200 bg-rose-50 text-rose-800",
  soon: "border-amber-200 bg-amber-50 text-amber-800",
  ok: "border-slate-200 bg-white text-slate-600",
} as const;

function DoneDialog({ task, today, onClose }: { task: ChecklistTask; today: string; onClose: () => void }) {
  const { run, pending } = useAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-lg">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Mark done: {task.title}</DialogTitle>
        </DialogHeader>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const record: Record<string, string> = {};
            for (const field of task.record_fields) record[field.key] = String(f.get(`record_${field.key}`) ?? "");
            const ok = await run(
              () =>
                completeChecklistTask(task.id, {
                  doneOn: String(f.get("done_on") ?? ""),
                  notes: String(f.get("notes") ?? ""),
                  evidenceUrl: String(f.get("evidence_url") ?? ""),
                  record,
                }),
              { success: "Done — next due date set", error: "Not saved" }
            );
            if (ok) onClose();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="done_on">Done on</Label>
            <Input id="done_on" name="done_on" type="date" defaultValue={today} max={today} required />
          </div>
          {task.record_fields.length > 0 && (
            <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <legend className="flex items-center gap-1 px-1 text-xs font-semibold text-slate-600">
                <Lock className="h-3 w-3" /> Private — kept in CoachOS, never on the website
              </legend>
              {task.record_fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`record_${field.key}`}>{field.label}</Label>
                  <Input
                    id={`record_${field.key}`}
                    name={`record_${field.key}`}
                    type={field.type === "date" ? "date" : "text"}
                    defaultValue={task.private_record[field.key] ?? ""}
                    autoComplete="off"
                  />
                </div>
              ))}
            </fieldset>
          )}
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} placeholder="What you checked and what you found" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="evidence_url">Evidence link</Label>
            <Input id="evidence_url" name="evidence_url" type="url" inputMode="url" placeholder="https://drive.google.com/…" />
            <p className="text-xs text-muted-foreground">A screenshot, letter or certificate in Google Drive, Dropbox…</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
              {pending ? "Saving..." : "Mark done"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ task, onClose }: { task: ChecklistTask; onClose: () => void }) {
  const { run, pending } = useAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-md">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await run(() => updateChecklistTask(task.id, String(f.get("owner") ?? ""), String(f.get("next_due") ?? "")), {
              success: "Saved",
              error: "Not saved",
            });
            if (ok) onClose();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="owner">Who owns it</Label>
            <Input id="owner" name="owner" defaultValue={task.owner} required maxLength={100} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="next_due">Next due</Label>
            <Input id="next_due" name="next_due" type="date" defaultValue={task.next_due} required />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ComplianceChecklistPanel({
  tasks,
  today,
  hints = {},
}: {
  tasks: ChecklistTask[];
  today: string;
  /** Live notes for a task by slug, e.g. "2 open privacy requests" (admin only). */
  hints?: Record<string, string>;
}) {
  const [doing, setDoing] = useState<ChecklistTask | null>(null);
  const [editing, setEditing] = useState<ChecklistTask | null>(null);
  const sorted = [...tasks].sort((a, b) => a.next_due.localeCompare(b.next_due) || a.sort_order - b.sort_order);
  const overdue = tasks.filter((t) => dueState(t.next_due, today).state === "overdue").length;
  const soon = tasks.filter((t) => dueState(t.next_due, today).state === "soon").length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Recurring checks that keep the policies true. Mark one done with a note and a link to the evidence; the next due
        date sets itself. {overdue > 0 && <strong className="text-rose-700">{overdue} overdue. </strong>}
        {soon > 0 && <span className="text-amber-700">{soon} due in the next two weeks.</span>}
      </p>
      <ul className="space-y-3">
        {sorted.map((t) => {
          const due = dueState(t.next_due, today);
          const last = t.completions[0];
          const recorded = t.record_fields.filter((f) => t.private_record[f.key]);
          return (
            <li key={t.id} data-testid={`task-${t.slug}`} className="rounded-2xl border bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.title}</span>
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", DUE_STYLE[due.state])} data-testid="task-due">
                      <CalendarClock className="h-3 w-3" />
                      {due.state === "overdue"
                        ? `${-due.days} day${due.days === -1 ? "" : "s"} overdue`
                        : due.days === 0
                          ? "Due today"
                          : `Due ${day(t.next_due)}`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {cadenceLabel(t.cadence)} · {t.owner}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">{t.description}</p>
                  {hints[t.slug] && <p className="mt-1 text-sm font-medium text-slate-900">{hints[t.slug]}</p>}
                  {t.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {t.links.map((l) =>
                        isInternalLink(l.url) ? (
                          <Link key={l.url} href={l.url} className="inline-flex min-h-8 items-center text-sky-700 underline underline-offset-2">
                            {l.label}
                          </Link>
                        ) : (
                          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-sky-700 underline underline-offset-2">
                            {l.label} <ExternalLink className="h-3 w-3" />
                          </a>
                        )
                      )}
                    </div>
                  )}
                  {recorded.length > 0 && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="task-private-record">
                      <Lock className="h-3 w-3 text-slate-400" />
                      {recorded.map((f) => (
                        <span key={f.key}>
                          {f.label}: <strong>{f.type === "date" ? day(t.private_record[f.key]) : t.private_record[f.key]}</strong>
                        </span>
                      ))}
                    </p>
                  )}
                  {last && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500" data-testid="task-last-done">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        Last done {day(last.done_on)} by {actorName(last.done_by)}
                        {last.notes && <> — {last.notes}</>}
                        {last.evidence_url && (
                          <>
                            {" "}
                            ·{" "}
                            <a href={last.evidence_url} target="_blank" rel="noreferrer" className="underline">
                              evidence
                            </a>
                          </>
                        )}
                      </span>
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-col">
                  <Button className="h-11 sm:h-9" onClick={() => setDoing(t)}>
                    Mark done
                  </Button>
                  <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEditing(t)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {doing && <DoneDialog task={doing} today={today} onClose={() => setDoing(null)} />}
      {editing && <EditDialog task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
