"use client";

import { ArrowRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatBusinessTime, formatDateOnly } from "@/lib/dates";
import { actorName, diffWords, DOCUMENT_LABEL, type LegalDocument } from "@/lib/legal-facts";
import { AUDIT_KINDS, type AuditEntry, type AuditFilters, type AuditKind } from "@/lib/audit-kinds";
import type { StaffRole } from "@/lib/admin";

const VERB: Record<string, string> = {
  "legal.fact.save": "saved a draft of",
  "legal.fact.submit": "sent for review",
  "legal.fact.needs_research": "marked as needing research",
  "legal.fact.discard": "discarded the draft of",
  "legal.fact.publish": "published",
  "legal.document.version": "minted a new version of",
  "checklist.complete": "marked done",
  "checklist.update": "changed",
};

const STATUS: Record<string, string> = {
  draft: "draft",
  needs_research: "needs research",
  in_review: "in review",
  published: "published",
  discarded: "discarded",
};

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateOnly(v, { month: "short", day: "numeric", year: "numeric" }) : str(v));

function ValueChange({ before, after }: { before: string; after: string }) {
  if (before === after) return <p className="mt-1 text-xs text-slate-500">Value unchanged: “{after}”</p>;
  return (
    <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-xs leading-relaxed">
      {diffWords(before, after).map((p, i) =>
        p.type === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.type === "add" ? (
          <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">{p.text}</ins>
        ) : (
          <del key={i} className="bg-rose-100 text-rose-800">{p.text}</del>
        )
      )}
    </p>
  );
}

function Detail({ e }: { e: AuditEntry }) {
  const d = e.detail ?? {};
  if (e.action.startsWith("legal.fact.")) {
    const from = str(d.from_status);
    const to = str(d.to_status);
    return (
      <>
        {(from || to) && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            {STATUS[from] ?? (from || "new")} <ArrowRight className="h-3 w-3" /> {STATUS[to] ?? to}
          </p>
        )}
        {"new_value" in d && <ValueChange before={str(d.old_value)} after={str(d.new_value)} />}
      </>
    );
  }
  if (e.action === "legal.document.version") {
    const keys = Array.isArray(d.keys) ? (d.keys as string[]) : [];
    return <p className="mt-0.5 text-xs text-slate-500">Because of: {keys.join(", ") || "—"}</p>;
  }
  if (e.action === "checklist.complete") {
    const recorded = Array.isArray(d.recorded) ? (d.recorded as string[]) : [];
    return (
      <p className="mt-0.5 text-xs text-slate-500">
        Done {day(d.done_on)} · due {day(d.old_due)} → next {day(d.new_due)}
        {d.evidence ? " · evidence linked" : ""}
        {recorded.length ? ` · recorded ${recorded.join(", ")} (private)` : ""}
      </p>
    );
  }
  if (e.action === "checklist.update") {
    return (
      <p className="mt-0.5 text-xs text-slate-500">
        Owner {str(d.old_owner)} → {str(d.new_owner)} · due {day(d.old_due)} → {day(d.new_due)}
      </p>
    );
  }
  // Other entries hold ids, counts and reasons only (lib/audit.ts).
  const summary = Object.entries(d)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");
  const lists = Object.entries(d)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${(v as unknown[]).length} ${k.replace(/_ids?$/, "").replace(/_/g, " ")}`)
    .join(" · ");
  return summary || lists ? <p className="mt-0.5 text-xs text-slate-500">{[summary, lists].filter(Boolean).join(" · ")}</p> : null;
}

function subject(e: AuditEntry): string {
  const d = e.detail ?? {};
  if (e.action.startsWith("legal.fact.")) return str(d.key);
  if (e.action === "legal.document.version") return `${DOCUMENT_LABEL[str(d.document) as LegalDocument] ?? str(d.document)} → v${str(d.version)}`;
  if (e.action.startsWith("checklist.")) return str(d.task).replace(/-/g, " ");
  return e.entity ?? "";
}

export function AuditLogPanel({
  entries,
  filters,
  role,
  factLabels,
}: {
  entries: AuditEntry[];
  filters: AuditFilters;
  role: StaffRole;
  factLabels: Record<string, string>;
}) {
  const kinds = (Object.keys(AUDIT_KINDS) as AuditKind[]).filter((k) => role === "admin" || k === "facts" || k === "checklist");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every change is written here and can&apos;t be edited or deleted — who, when, and what it was before and after.
        {role === "compliance" && " You see policy-fact and checklist history."}
      </p>

      <form method="get" action="/compliance" className="grid grid-cols-2 gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end" data-testid="audit-filters">
        <input type="hidden" name="tab" value="audit" />
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor="audit-kind">What</Label>
          <Select
            id="audit-kind"
            name="kind"
            defaultValue={filters.kind ?? ""}
            options={[{ value: "", label: "Everything" }, ...kinds.map((k) => ({ value: k, label: AUDIT_KINDS[k].label }))]}
          />
        </div>
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor="audit-actor">Who</Label>
          <Input id="audit-actor" name="actor" defaultValue={filters.actor ?? ""} placeholder="email" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <Button type="submit" variant="outline" className="col-span-2 h-11 sm:col-span-1 sm:h-10">
          <Filter className="mr-1 h-4 w-4" /> Filter
        </Button>
      </form>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing recorded for these filters.</p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-2xl border bg-white" data-testid="audit-entries">
          {entries.map((e) => {
            const subj = subject(e);
            return (
              <li key={e.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4" data-testid="audit-entry">
                <time className="text-xs tabular-nums text-slate-500" dateTime={e.at}>
                  {formatBusinessTime(e.at)}
                </time>
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="font-medium">{actorName(e.actor)}</span>{" "}
                    <span className="text-slate-600">{VERB[e.action] ?? e.action}</span>{" "}
                    {subj && <span className="font-medium">{factLabels[subj] ?? subj}</span>}
                  </p>
                  <Detail e={e} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {entries.length >= 300 && <p className="text-xs text-muted-foreground">Showing the latest 300. Narrow the filters to see older entries.</p>}
    </div>
  );
}
