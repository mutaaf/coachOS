"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpenCheck, ExternalLink, FileText, Lock, Search, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { formatBusinessTime, formatDateOnly } from "@/lib/dates";
import type { StaffRole } from "@/lib/admin";
import {
  actorName,
  affectedDocuments,
  changesValue,
  diffWords,
  displayState,
  DOCUMENT_LABEL,
  invalidSources,
  isDueForReview,
  isPlaceholder,
  matchesFilter,
  nextDocumentVersion,
  parseSources,
  progress,
  renderPreview,
  STATE_LABEL,
  type DisplayState,
  type FactFilter,
  type LegalDocument,
  type PolicyFact,
} from "@/lib/legal-facts";
import {
  discardFactDraft,
  markFactNeedsResearch,
  publishFactNow,
  publishFacts,
  saveFactDraft,
  sendFactForReview,
} from "@/lib/actions/legal-facts";
import type { PolicyFactsData } from "@/lib/queries/audit-compliance";

const STATE_STYLE: Record<DisplayState, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  verify: "border-amber-200 bg-amber-50 text-amber-800",
  needs_research: "border-rose-200 bg-rose-50 text-rose-800",
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  in_review: "border-sky-200 bg-sky-50 text-sky-800",
  read_only: "border-slate-200 bg-white text-slate-500",
};

const FILTERS: { id: FactFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_research", label: "Needs research" },
  { id: "due", label: "Due for review" },
  { id: "drafts", label: "Drafts" },
  { id: "in_review", label: "In review" },
];

const shortDate = (iso: string) => formatDateOnly(iso.slice(0, 10), { month: "short", day: "numeric", year: "numeric" });

function StateChip({ state }: { state: DisplayState }) {
  return (
    <span
      data-testid="fact-status"
      className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", STATE_STYLE[state])}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/** The fact in its website sentence, set like the policy page it lives on. */
function WebsitePreview({ fact, value }: { fact: PolicyFact; value: string }) {
  const parts = renderPreview(fact.preview, value || "…");
  return (
    <figure className="rounded-xl border border-amber-200/70 bg-[#fffdf7] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.8)]" data-testid="fact-preview">
      <figcaption className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-900/70">
        <FileText className="h-3.5 w-3.5" />
        On the website · {fact.documents.map((d) => DOCUMENT_LABEL[d]).join(", ") || "not shown on a policy page"}
      </figcaption>
      <p className="font-serif text-[15px] leading-relaxed text-slate-800">
        {parts.map((p, i) =>
          p.fact ? (
            <mark key={i} className={cn("rounded px-0.5", isPlaceholder(value) ? "bg-rose-100 text-rose-900" : "bg-amber-100/80 text-slate-900")}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </p>
    </figure>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <p className="whitespace-pre-wrap break-words rounded-lg border bg-white p-3 text-sm leading-relaxed" data-testid="fact-diff">
      {parts.map((p, i) =>
        p.type === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.type === "add" ? (
          <ins key={i} className="rounded bg-emerald-100 text-emerald-900 no-underline">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="rounded bg-rose-100 text-rose-800">
            {p.text}
          </del>
        )
      )}
    </p>
  );
}

function FactEditor({
  fact,
  role,
  docVersions,
  today,
  onClose,
}: {
  fact: PolicyFact;
  role: StaffRole;
  docVersions: Map<string, string[]>;
  today: string;
  onClose: () => void;
}) {
  const start = fact.working ?? fact.published;
  const [value, setValue] = useState(start?.value ?? "");
  const [notes, setNotes] = useState(fact.working?.research_notes ?? "");
  const [sourcesText, setSourcesText] = useState((fact.working?.sources ?? []).join("\n"));
  const { run, pending } = useAction();

  const published = fact.published?.value ?? "";
  const sources = parseSources(sourcesText);
  const badSources = invalidSources(sources);
  const unfilled = isPlaceholder(value);
  const changed = value.trim() !== published;
  const input = () => ({ value, researchNotes: notes, sources });
  const canPublish = role === "admin";

  async function act(fn: () => Promise<{ error?: string } | object>, success: string, close = true) {
    const ok = await run(fn as () => Promise<{ error?: string }>, { success, error: "Not saved" });
    if (ok && close) onClose();
  }

  if (!fact.editable) {
    return (
      <div className="space-y-4 text-sm">
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-slate-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          {fact.help}
        </p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current value</p>
          <p className="mt-1 break-words font-medium">{fact.published?.value}</p>
        </div>
        <WebsitePreview fact={fact} value={fact.published?.value ?? ""} />
      </div>
    );
  }

  const willVersion = changed ? fact.documents.map((d) => `${DOCUMENT_LABEL[d]} ${nextDocumentVersion(docVersions.get(d) ?? [], today)}`) : [];

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-slate-50 p-4 text-sm">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <BookOpenCheck className="h-3.5 w-3.5" /> What to research
        </p>
        <p className="mt-1.5 leading-relaxed text-slate-700">{fact.help}</p>
        {fact.links.length > 0 && (
          <ul className="mt-2 space-y-1">
            {fact.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-sky-700 underline underline-offset-2 hover:text-sky-900">
                  {l.label} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On the website now</p>
        {fact.published ? (
          <>
            <p className="break-words text-sm" data-testid="fact-published-value">{fact.published.value}</p>
            <p className="text-xs text-muted-foreground">
              Published {formatBusinessTime(fact.published.published_at!)}
              {fact.published.reviewed_by && ` by ${actorName(fact.published.reviewed_by)}`}
              {fact.published.verified ? "" : " · not verified yet"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing published — the website shows its own placeholder.</p>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="fact-value">Value</Label>
        <Textarea id="fact-value" rows={4} value={value} onChange={(e) => setValue(e.target.value)} className="text-[15px]" />
        <p className="text-xs text-muted-foreground">Plain text — it drops into the sentence below. No HTML.</p>
        <WebsitePreview fact={fact} value={value} />
        {fact.published && changed && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What changes</p>
            <Diff before={published} after={value.trim()} />
          </div>
        )}
        {fact.published && !changed && (
          <p className="text-xs text-emerald-700">Same as the published value — sending it for review confirms it as verified.</p>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="fact-notes">Research notes</Label>
        <Textarea
          id="fact-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you checked, who you asked, what it said. Only staff see this."
        />
        <Label htmlFor="fact-sources">Source links</Label>
        <Textarea
          id="fact-sources"
          rows={2}
          value={sourcesText}
          onChange={(e) => setSourcesText(e.target.value)}
          placeholder="https://… (one per line)"
          aria-invalid={badSources.length > 0}
        />
        {badSources.length > 0 && <p className="text-xs text-rose-700">Not a web address: {badSources[0]}</p>}
      </section>

      {fact.working && (
        <p className="text-xs text-muted-foreground">
          {STATE_LABEL[fact.working.status as DisplayState]} · last edited {formatBusinessTime(fact.working.edited_at)} by {actorName(fact.working.edited_by)}
        </p>
      )}

      {fact.history.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Earlier published values ({fact.history.length})</summary>
          <ul className="mt-2 space-y-2">
            {fact.history.map((h) => (
              <li key={h.id}>
                <p className="break-words">{h.value}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBusinessTime(h.published_at!)} · {actorName(h.reviewed_by)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {canPublish && willVersion.length > 0 && (
          <p className="text-xs text-muted-foreground">Publishing gives new versions to: {willVersion.join(" · ")}</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {fact.working && (
            <Button variant="ghost" className="h-11 sm:h-10 sm:mr-auto" disabled={pending} onClick={() => act(() => discardFactDraft(fact.key), "Draft discarded")}>
              Discard draft
            </Button>
          )}
          <Button variant="outline" className="h-11 sm:h-10" disabled={pending || badSources.length > 0} onClick={() => act(() => markFactNeedsResearch(fact.key, input()), "Marked as needing research")}>
            Needs research
          </Button>
          <Button variant="outline" className="h-11 sm:h-10" disabled={pending || badSources.length > 0} onClick={() => act(() => saveFactDraft(fact.key, input()), "Draft saved")}>
            Save draft
          </Button>
          <Button
            className="h-11 sm:h-10"
            variant={canPublish ? "outline" : "default"}
            disabled={pending || unfilled || badSources.length > 0}
            onClick={() => act(() => sendFactForReview(fact.key, input()), "Sent for review")}
          >
            <Send className="mr-1 h-4 w-4" /> Send for review
          </Button>
          {canPublish && (
            <Button
              className="h-11 sm:h-10"
              disabled={pending || unfilled || badSources.length > 0}
              onClick={() => act(() => publishFactNow(fact.key, input()), "Published to the website")}
            >
              <Sparkles className="mr-1 h-4 w-4" /> Publish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressMeter({ verified, total }: { verified: number; total: number }) {
  const pct = total ? Math.round((verified / total) * 100) : 0;
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-white to-emerald-50/60 p-4 sm:p-5" data-testid="facts-progress">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">Policy facts verified</p>
        <p className="text-sm tabular-nums text-slate-500">{pct}%</p>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
        {verified} <span className="text-base font-medium text-slate-500">of {total} verified</span>
      </p>
      <div className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-full flex-1", i < verified ? "bg-emerald-500" : "bg-slate-200")} />
        ))}
      </div>
    </div>
  );
}

function PublishBar({
  facts,
  role,
  docVersions,
  today,
}: {
  facts: PolicyFact[];
  role: StaffRole;
  docVersions: Map<string, string[]>;
  today: string;
}) {
  const { run, pending } = useAction();
  const [confirming, setConfirming] = useState(false);
  const ready = facts.filter((f) => f.working?.status === "in_review");
  if (ready.length === 0) return null;
  const docs = [...affectedDocuments(facts).entries()].map(([d, keys]) => ({
    document: d,
    label: DOCUMENT_LABEL[d],
    version: nextDocumentVersion(docVersions.get(d) ?? [], today),
    keys,
  }));

  async function publish() {
    let result: Awaited<ReturnType<typeof publishFacts>> | null = null;
    const ok = await run(
      async () => {
        result = await publishFacts();
        return result;
      },
      { error: "Not published" }
    );
    if (ok && result && "documents" in result) {
      const r = result as { published: string[]; documents: { document: string; version: string }[] };
      toast.success(`Published ${r.published.length} fact${r.published.length === 1 ? "" : "s"}`, {
        description: r.documents.length
          ? `New versions: ${r.documents.map((d) => `${DOCUMENT_LABEL[d.document as LegalDocument] ?? d.document} ${d.version}`).join(", ")}`
          : "No wording changed, so no document needed a new version.",
      });
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="sticky bottom-3 z-20 rounded-2xl border border-sky-200 bg-sky-950 p-4 text-sky-50 shadow-xl shadow-sky-900/20" data-testid="publish-bar">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">
              {ready.length} change{ready.length === 1 ? "" : "s"} waiting to be published
            </p>
            <p className="mt-0.5 text-sky-200">
              {docs.length
                ? `New versions: ${docs.map((d) => `${d.label} ${d.version}`).join(" · ")}`
                : "Confirmations only — no wording changes, so no new document versions."}
            </p>
          </div>
          {role === "admin" ? (
            <Button className="h-11 bg-white text-sky-950 hover:bg-sky-100 sm:h-10" disabled={pending} onClick={() => setConfirming(true)}>
              <Sparkles className="mr-1 h-4 w-4" /> Publish changes
            </Button>
          ) : (
            <p className="text-xs text-sky-200">An admin publishes these to the website.</p>
          )}
        </div>
      </div>

      <Sheet
        open={confirming}
        onOpenChange={setConfirming}
        title="Publish to the website"
        description="These go live on risingstars.training within a minute. No deploy needed."
        footer={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
            <Button className="h-11 sm:h-10" onClick={publish} disabled={pending} data-testid="confirm-publish">
              {pending ? "Publishing…" : `Publish ${ready.length}`}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {docs.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New document versions</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {docs.map((d) => (
                  <li key={d.document} className="rounded-lg border bg-[#fffdf7] p-3 text-sm">
                    <p className="font-medium">{d.label}</p>
                    <p className="font-mono text-xs text-slate-600">v{d.version} · effective today</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facts</p>
            {ready.map((f) => (
              <div key={f.key} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">Sent by {actorName(f.working!.submitted_by ?? f.working!.edited_by)}</p>
                <div className="mt-2">
                  {changesValue(f) ? (
                    <Diff before={f.published?.value ?? ""} after={f.working!.value} />
                  ) : (
                    <p className="text-emerald-700">Confirmed unchanged — will be marked verified.</p>
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      </Sheet>
    </>
  );
}

export function PolicyFactsPanel({ data, role, today }: { data: PolicyFactsData; role: StaffRole; today: string }) {
  const { facts, documents } = data;
  const [filter, setFilter] = useState<FactFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const docVersions = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of documents) m.set(d.document, [...(m.get(d.document) ?? []), d.version]);
    return m;
  }, [documents]);
  const current = useMemo(() => {
    const seen = new Map<string, { version: string; effective_date: string }>();
    for (const d of documents) if (!seen.has(d.document)) seen.set(d.document, d);
    return seen;
  }, [documents]);

  const editable = facts.filter((f) => f.editable);
  const technical = facts.filter((f) => !f.editable);
  const { verified, total } = progress(facts);
  const counts = Object.fromEntries(FILTERS.map((x) => [x.id, editable.filter((f) => matchesFilter(f, x.id, today)).length]));
  const q = query.trim().toLowerCase();
  const shown = editable.filter(
    (f) => matchesFilter(f, filter, today) && (!q || `${f.label} ${f.key} ${f.published?.value ?? ""} ${f.working?.value ?? ""}`.toLowerCase().includes(q))
  );
  const groups = [...new Set(shown.map((f) => f.category))];
  const open = facts.find((f) => f.key === editing) ?? null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ProgressMeter verified={verified} total={total} />
        <div className="rounded-2xl border bg-white p-4 sm:p-5">
          <p className="text-sm font-medium text-slate-600">Website documents</p>
          <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2" data-testid="document-versions">
            {(Object.keys(DOCUMENT_LABEL) as LegalDocument[]).map((d) => (
              <li key={d} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{DOCUMENT_LABEL[d]}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{current.get(d) ? `v${current.get(d)!.version}` : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        These are the facts the website&apos;s policy pages are built from. Research each one, correct it if it isn&apos;t
        true, and send it for review — {role === "admin" ? "you publish" : "an admin publishes"} it to the website, no deploy
        needed. Not legal advice: the attorney confirms them once a year (Checklist).
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Show">
          {FILTERS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={filter === x.id}
              onClick={() => setFilter(x.id)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                filter === x.id ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              {x.label}
              <span className={cn("tabular-nums text-xs", filter === x.id ? "text-slate-300" : "text-slate-400")}>{counts[x.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input aria-label="Search facts" placeholder="Search facts" value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 pl-9" />
        </div>
      </div>

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing here.</p>
      )}

      {groups.map((category) => (
        <section key={category} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{category}</h3>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {shown
              .filter((f) => f.category === category)
              .map((f) => {
                const state = displayState(f);
                const due = isDueForReview(f, today);
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => setEditing(f.key)}
                      data-testid={`fact-${f.key}`}
                      className="group flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:flex-row sm:items-start sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{f.label}</span>
                          <StateChip state={state} />
                          {due && state !== "verify" && (
                            <Badge variant="warning" className="text-[11px]">Review due</Badge>
                          )}
                        </div>
                        <p className={cn("mt-1 line-clamp-2 break-words text-sm", f.published && !isPlaceholder(f.published.value) ? "text-slate-600" : "italic text-rose-700")}>
                          {f.published && !isPlaceholder(f.published.value) ? f.published.value : f.working?.value || "Not filled in yet"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:w-48 sm:flex-col sm:text-right">
                        <span>{f.lastVerifiedAt ? `Verified ${shortDate(f.lastVerifiedAt)}` : "Never verified"}</span>
                        {f.published?.review_due && <span className={cn(due && "font-medium text-amber-700")}>Review by {shortDate(f.published.review_due)}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {filter === "all" && !q && technical.length > 0 && (
        <details className="rounded-2xl border bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Set in the website&apos;s code ({technical.length}) <span className="font-normal text-muted-foreground">— read-only here</span>
          </summary>
          <ul className="divide-y border-t">
            {technical.map((f) => (
              <li key={f.key}>
                <button type="button" onClick={() => setEditing(f.key)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="w-44 shrink-0 font-medium">{f.label}</span>
                  <span className="min-w-0 truncate text-slate-600">{f.published?.value}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <PublishBar facts={facts} role={role} docVersions={docVersions} today={today} />

      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setEditing(null)}
        title={open?.label}
        description={
          open && (
            <span className="flex flex-wrap items-center gap-2">
              <StateChip state={displayState(open)} />
              <span>{open.category}</span>
              <code className="rounded bg-slate-100 px-1 text-xs">{open.key}</code>
            </span>
          )
        }
      >
        {open && <FactEditor key={open.key + (open.working?.edited_at ?? "")} fact={open} role={role} docVersions={docVersions} today={today} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
