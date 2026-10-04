"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CopyButton } from "@/components/ui/copy-button";
import { startTour } from "@/components/guided-tour";
import { saveTestResult } from "@/lib/actions/help";
import { AUTOMATIC, GLOSSARY, PRACTICE, TASKS, TEST_CARDS, type HelpStep } from "@/lib/help/content";
import cases from "@/lib/help/acceptance-cases.json";
import type { TestResult } from "@/lib/queries/onboarding";
import type { Release } from "@/lib/releases";
import { businessToday } from "@/lib/dates";
import { ReleaseNotes } from "@/components/whats-new";
import { Check, ChevronRight, Download, ExternalLink, PlayCircle, Search } from "lucide-react";

/* ---------------------------------------------------------------------------
 * Rich text: **bold**, [[Button]] drawn like the app's buttons, {status} badges
 * ------------------------------------------------------------------------- */

const BADGE: Record<string, string> = {
  pending: "bg-orange-100 text-orange-800",
  processing: "bg-secondary text-secondary-foreground",
  overdue: "bg-destructive text-destructive-foreground",
  paid: "bg-green-100 text-green-800",
  waived: "bg-secondary text-secondary-foreground",
};

function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|\{(?:pending|processing|overdue|paid|waived)\})/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("[[")) {
          const label = p.slice(2, -2);
          const wa = label === "WhatsApp";
          return (
            <span
              key={i}
              className={`mx-0.5 inline-flex items-center rounded-md px-2 py-0.5 align-middle text-xs font-semibold ${
                wa ? "bg-[#25D366] text-white" : "border bg-white text-foreground shadow-sm"
              }`}
            >
              {label}
            </span>
          );
        }
        if (p.startsWith("{")) {
          const s = p.slice(1, -1);
          return (
            <span key={i} className={`mx-0.5 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${BADGE[s]}`}>
              {s}
            </span>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Steps({ steps, done, onToggle }: { steps: HelpStep[]; done: number[]; onToggle: (i: number) => void }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const ticked = done.includes(i);
        return (
          <li key={i} className="grid grid-cols-[2.75rem_1fr] gap-3">
            <button
              type="button"
              onClick={() => onToggle(i)}
              aria-label={`Step ${i + 1}: mark as ${ticked ? "not done" : "done"}`}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums ${
                ticked ? "border-green-600 bg-green-600 text-white" : "border-border text-muted-foreground"
              }`}
            >
              {ticked ? <Check className="h-4 w-4" /> : i + 1}
            </button>
            <div className={`min-w-0 space-y-2 pt-2.5 ${ticked ? "text-muted-foreground" : ""}`}>
              <p>
                <Rich text={s.text} />
              </p>
              {s.tip && (
                <p
                  className={`rounded-lg px-3 py-2 text-sm ${
                    s.careful ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-900"
                  }`}
                >
                  <strong>{s.careful ? "Careful: " : "Tip: "}</strong>
                  <Rich text={s.tip} />
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Ticks on how-to steps are a personal checklist: kept in this browser only. */
function useTicks() {
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  useEffect(() => {
    try {
      setTicks(JSON.parse(localStorage.getItem("help-ticks") || "{}"));
    } catch {}
  }, []);
  function toggle(id: string, i: number) {
    setTicks((prev) => {
      const set = new Set(prev[id] || []);
      set.has(i) ? set.delete(i) : set.add(i);
      const next = { ...prev, [id]: [...set] };
      try {
        localStorage.setItem("help-ticks", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  return { ticks, toggle };
}

/* ---------------------------------------------------------------------------
 * How do I…
 * ------------------------------------------------------------------------- */

function HowTo() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { ticks, toggle } = useTicks();
  const list = TASKS.filter((t) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [t.title, t.when, t.keywords, ...t.steps.map((s) => s.text + " " + (s.tip ?? ""))].join(" ").toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: zelle, cash, new kid, link, attendance…"
          aria-label="Search help"
          className="h-12 w-full rounded-xl border bg-white pl-10 pr-3 text-base"
        />
      </div>
      {list.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing matches. Try a simpler word, like “zelle” or “cash”.
        </p>
      )}
      <div className="grid gap-3">
        {list.map((t) => {
          const done = ticks[t.id] || [];
          const all = done.length === t.steps.length;
          const isOpen = open === t.id || (!!q && list.length === 1);
          return (
            <article key={t.id} id={`task-${t.id}`} data-testid="help-task" className="overflow-hidden rounded-2xl border bg-white">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : t.id)}
                aria-expanded={isOpen}
                className="grid min-h-[72px] w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${
                    all ? "bg-green-100 text-green-700" : "bg-orange-50 text-orange-700"
                  }`}
                >
                  {all ? <Check className="h-5 w-5" /> : `${done.length}/${t.steps.length}`}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{t.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{t.when}</span>
                </span>
                <ChevronRight className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
              {isOpen && (
                <div className="space-y-4 border-t px-4 pb-5 pt-4">
                  <div className="flex flex-wrap gap-2">
                    {t.tourStep && (
                      <button
                        type="button"
                        onClick={() => startTour(t.tourStep)}
                        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
                      >
                        <PlayCircle className="h-4 w-4" /> Show me
                      </button>
                    )}
                    <Link
                      href={t.href}
                      className="inline-flex h-11 min-w-0 items-center gap-1.5 rounded-lg border bg-white px-4 text-sm font-semibold"
                    >
                      <ExternalLink className="h-4 w-4" /> {t.hrefLabel}
                    </Link>
                  </div>
                  <Steps steps={t.steps} done={done} onToggle={(i) => toggle(t.id, i)} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Practise safely
 * ------------------------------------------------------------------------- */

function Practice({ testMode }: { testMode: boolean }) {
  const { ticks, toggle } = useTicks();
  return (
    <div className="space-y-5">
      <div
        className={`rounded-2xl border p-4 ${
          testMode ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-300 bg-red-50 text-red-900"
        }`}
      >
        <p className="font-semibold">
          {testMode ? "You're in test mode — try anything." : "Card and bank payments are LIVE — real money moves."}
        </p>
        <p className="mt-1 text-sm">
          {testMode
            ? "Card and bank payments here are pretend, with Stripe's test cards; nothing is charged. Zelle and cash are always real, so try those with $1 or by recording a pretend payment."
            : "Ask Mutaaf to switch back to test mode before trying card or bank payments."}
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold">Test cards and bank</h3>
        <p className="mb-3 text-sm text-muted-foreground">Use any future expiry date, any 3-digit code and any ZIP.</p>
        <div className="divide-y">
          {TEST_CARDS.map((c) => (
            <div key={c.copy} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold tabular-nums">{c.number}</p>
                <p className="text-sm text-muted-foreground">{c.what}</p>
              </div>
              <div className="shrink-0">
                <CopyButton value={c.copy} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {PRACTICE.map((p) => (
        <section key={p.id} className="rounded-2xl border bg-white p-4" data-testid="practice">
          <h3 className="font-semibold">{p.title}</h3>
          <p className="mb-3 text-sm text-muted-foreground">{p.why}</p>
          <Steps steps={p.steps} done={ticks[p.id] || []} onToggle={(i) => toggle(p.id, i)} />
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Test plan: the auditor's checklist, recorded in CoachOS
 * ------------------------------------------------------------------------- */

interface Case {
  id: string;
  area: string;
  title: string;
  risk: string;
  severity: "critical" | "high" | "medium";
  preconditions: string[];
  steps: string[];
  expected: string[];
  evidence: string;
  phone: boolean;
}

const CASES = cases as Case[];
const STATUS = {
  pass: { mark: "✓", label: "Pass", on: "border-green-600 bg-green-50 text-green-800" },
  fail: { mark: "✗", label: "Fail", on: "border-red-600 bg-red-50 text-red-800" },
  blocked: { mark: "⊘", label: "Blocked", on: "border-amber-600 bg-amber-50 text-amber-800" },
  na: { mark: "—", label: "N/A", on: "border-slate-500 bg-slate-100 text-slate-700" },
} as const;
type Status = keyof typeof STATUS;
const AREAS = [...new Set(CASES.map((c) => c.area))];

function TestPlan({ initial }: { initial: TestResult[] }) {
  const [results, setResults] = useState<Record<string, TestResult>>(() =>
    Object.fromEntries(initial.map((r) => [r.case_id, r]))
  );
  const [area, setArea] = useState("");
  const [sev, setSev] = useState("");
  const [stat, setStat] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, blocked: 0, na: 0 };
    for (const r of Object.values(results)) if (r.status) c[r.status]++;
    return c;
  }, [results]);
  const run = counts.pass + counts.fail + counts.blocked + counts.na;
  const exceptions = CASES.filter((c) => results[c.id]?.status === "fail" || results[c.id]?.status === "blocked");

  const list = CASES.filter(
    (c) =>
      (!area || c.area === area) &&
      (!sev || c.severity === sev) &&
      (!stat || (stat === "open" ? !results[c.id]?.status : results[c.id]?.status === stat))
  );

  async function save(id: string, patch: Partial<Pick<TestResult, "status" | "ticks" | "notes">>) {
    const prev = results[id];
    const next: TestResult = {
      ...(prev ?? { case_id: id, status: null, ticks: [], notes: "", updated_by: null }),
      ...patch,
      updated_at: new Date().toISOString(),
    };
    setResults((r) => ({ ...r, [id]: next }));
    const res = await saveTestResult(id, patch as any);
    if ("error" in res && res.error) {
      toast.error("Not saved", { description: res.error });
      setResults((r) => ({ ...r, [id]: prev as TestResult }));
    }
  }

  function exportCsv() {
    const cell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [["ID", "Area", "Title", "Severity", "Result", "Expected ticked", "Notes", "Updated by", "Updated at"]];
    for (const c of CASES) {
      const r = results[c.id];
      rows.push([c.id, c.area, c.title, c.severity, r?.status ? STATUS[r.status].label : "Not run", `${r?.ticks?.length ?? 0} of ${c.expected.length}`, r?.notes ?? "", r?.updated_by ?? "", r?.updated_at ?? ""]);
    }
    const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `coachos-test-results-${businessToday()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Each filter row scrolls sideways on a phone instead of wrapping into ragged lines.
  const chipRow =
    "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden";
  const chip = (on: boolean) =>
    `h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm ${on ? "border-foreground bg-foreground text-background" : "bg-white"}`;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {CASES.length} checks, written for an auditor: what could go wrong, exactly what to do, and what you should see.
        Results are saved in CoachOS. Use test families only, and keep screenshots in a folder named by test ID (e.g.
        PAY-06).
      </p>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5 [&>:first-child]:col-span-2 sm:[&>:first-child]:col-span-1" data-testid="test-tally">
        {[
          [`${run}/${CASES.length}`, "run", ""],
          [counts.pass, "✓ passed", "text-green-700"],
          [counts.fail, "✗ exceptions", "text-red-700"],
          [counts.blocked, "⊘ blocked", "text-amber-700"],
          [CASES.filter((c) => c.severity === "critical" && !results[c.id]?.status).length, "critical not run", ""],
        ].map(([n, label, cls], i) => (
          <div key={i} className="bg-white p-3">
            <p className={`font-mono text-xl font-semibold tabular-nums ${cls}`}>{n}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {exceptions.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Exception log</h3>
          {exceptions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setArea("");
                setSev("");
                setStat("");
                setOpen(c.id);
                setTimeout(() => document.getElementById(`case-${c.id}`)?.scrollIntoView({ block: "start" }), 50);
              }}
              className={`block w-full rounded-lg border border-l-4 bg-white p-3 text-left ${
                results[c.id]?.status === "fail" ? "border-l-red-600" : "border-l-amber-600"
              }`}
            >
              <span className="font-mono text-sm font-semibold text-primary">
                {c.id} {STATUS[results[c.id]!.status as Status].mark}
              </span>{" "}
              <span className="font-medium">{c.title}</span>
              <span className="mt-1 block whitespace-pre-wrap text-sm text-muted-foreground">
                {results[c.id]?.notes || "No notes yet — add what happened."}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className={chipRow}>
          <button className={chip(!area)} onClick={() => setArea("")}>All areas</button>
          {AREAS.map((a) => (
            <button key={a} className={chip(area === a)} onClick={() => setArea(a)}>
              {a}
            </button>
          ))}
        </div>
        <div className={chipRow}>
          {[["", "Any severity"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"]].map(([v, l]) => (
            <button key={v} className={chip(sev === v)} onClick={() => setSev(v)}>{l}</button>
          ))}
        </div>
        <div className={chipRow}>
          {[["", "Any result"], ["open", "Not run"], ["pass", "✓ Pass"], ["fail", "✗ Fail"], ["blocked", "⊘ Blocked"]].map(([v, l]) => (
            <button key={`s${v}`} className={chip(stat === v)} onClick={() => setStat(v)}>{l}</button>
          ))}
        </div>
        <div className="flex sm:justify-end">
          <button className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border bg-white px-4 text-sm font-medium sm:h-10 sm:w-auto" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        {list.map((c) => {
          const r = results[c.id];
          const isOpen = open === c.id;
          const ticks = new Set(r?.ticks ?? []);
          const border =
            r?.status === "pass" ? "border-l-green-600" : r?.status === "fail" ? "border-l-red-600" : r?.status === "blocked" ? "border-l-amber-600" : r?.status === "na" ? "border-l-slate-400" : "border-l-border";
          return (
            <article key={c.id} id={`case-${c.id}`} data-testid="test-case" className={`rounded-xl border border-l-4 bg-white ${border}`}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.id)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 text-left"
              >
                <span className="pt-0.5 font-mono text-sm font-semibold text-primary">{c.id}</span>
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">{c.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono font-semibold uppercase ${
                        c.severity === "critical" ? "border-red-300 text-red-700" : c.severity === "high" ? "border-amber-300 text-amber-700" : ""
                      }`}
                    >
                      {c.severity}
                    </span>
                    {c.area}
                    {c.phone && <span>· on a phone</span>}
                  </span>
                </span>
                <span className="w-6 pt-0.5 text-center font-mono text-lg">
                  {r?.status ? STATUS[r.status].mark : <span className="text-border">○</span>}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t px-4 pb-4 pt-4 text-[15px]">
                  <div className="rounded-lg bg-blue-50 p-3 text-blue-950">
                    <p className="text-xs font-semibold uppercase tracking-wide">If this fails</p>
                    <p>{c.risk}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before you start</p>
                    <ul className="list-disc space-y-1 pl-5">{c.preconditions.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
                    <ol className="list-decimal space-y-1 pl-5">{c.steps.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expected — tick each one you saw</p>
                    <ul className="space-y-2">
                      {c.expected.map((e, i) => (
                        <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-2">
                          <input
                            type="checkbox"
                            id={`exp-${c.id}-${i}`}
                            checked={ticks.has(i)}
                            onChange={(ev) => {
                              const next = new Set(ticks);
                              ev.target.checked ? next.add(i) : next.delete(i);
                              save(c.id, { ticks: [...next].sort((a, b) => a - b) });
                            }}
                            className="mt-0.5 h-6 w-6 accent-green-600"
                          />
                          <label htmlFor={`exp-${c.id}-${i}`} className={`-my-1 py-1 ${ticks.has(i) ? "text-muted-foreground" : ""}`}>{e}</label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence to keep</p>
                    <p>{c.evidence}</p>
                  </div>
                  <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`Result for ${c.id}`}>
                      {(Object.keys(STATUS) as Status[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={r?.status === s}
                          onClick={() => save(c.id, { status: r?.status === s ? null : s })}
                          className={`h-11 rounded-lg border font-semibold ${r?.status === s ? STATUS[s].on : "bg-white"}`}
                        >
                          <span className="font-mono">{STATUS[s].mark}</span> {STATUS[s].label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      aria-label={`Notes for ${c.id}`}
                      defaultValue={r?.notes ?? ""}
                      onBlur={(e) => e.target.value !== (r?.notes ?? "") && save(c.id, { notes: e.target.value })}
                      placeholder={r?.status === "fail" ? "What happened instead? Times, amounts, what you clicked." : "Notes — what you saw, anything odd, why it was blocked."}
                      className="min-h-[88px] w-full rounded-lg border bg-white p-3 text-base"
                    />
                    {r?.updated_at && (
                      <p className="font-mono text-xs text-muted-foreground">
                        Saved {new Date(r.updated_at).toLocaleString()}
                        {r.updated_by ? ` · ${r.updated_by}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * What things mean
 * ------------------------------------------------------------------------- */

function Reference() {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">What happens by itself</h3>
        <div className="divide-y rounded-2xl border bg-white">
          {AUTOMATIC.map((a) => (
            <div key={a.when} className="grid gap-1 p-4 sm:grid-cols-[7rem_1fr] sm:gap-4">
              <span className="font-semibold text-orange-700">{a.when}</span>
              <span>
                <strong>{a.what}</strong>{" "}
                <span className="text-muted-foreground">
                  <Rich text={a.detail} />
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">What the words and colours mean</h3>
        <div className="grid gap-2">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="grid gap-1 rounded-xl border bg-white p-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
              <span>
                <Rich text={g.term} />
              </span>
              <span>{g.meaning}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold">Something looks wrong?</h3>
        <p className="mt-1 text-muted-foreground">
          Take a screenshot of what you see and send it to Mutaaf with what you were trying to do. You can replay the tour
          any time from <strong>Take the tour</strong> in the menu.
        </p>
      </section>
    </div>
  );
}

interface Report {
  id: string;
  created_at: string;
  message: string;
  status: "new" | "sent" | "fixed" | "closed";
  fixed_in: string | null;
}

function WhatsNew({ releases, reports }: { releases: Release[]; reports: Report[] }) {
  return (
    <div className="space-y-6">
      {reports.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Problems you reported</h3>
          <ul className="divide-y rounded-2xl border bg-white">
            {reports.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 p-3 text-sm" data-testid="my-report">
                <span className="min-w-0">
                  <span className="line-clamp-2">{r.message}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    r.status === "fixed" ? "bg-green-100 text-green-800" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {r.status === "fixed" ? `Fixed in v${r.fixed_in}` : r.status === "closed" ? "Closed" : "Being looked at"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {releases.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Updates will be listed here as they arrive.
        </p>
      ) : (
        <div className="space-y-5 rounded-2xl border bg-white p-4">
          {releases.map((r) => (
            <ReleaseNotes key={r.version} release={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HelpPageClient({
  results,
  testMode,
  initialTab,
  releases = [],
  reports = [],
}: {
  results: TestResult[];
  testMode: boolean;
  initialTab?: string;
  releases?: Release[];
  reports?: Report[];
}) {
  const tabCls = "h-10 rounded-lg px-3.5";
  const tab = ["how", "practise", "tests", "reference", "new"].includes(initialTab ?? "") ? initialTab! : "how";
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Help</h1>
        <p className="mt-1 text-muted-foreground">
          Step-by-step guides. Tap <strong>Show me</strong> on any of them and CoachOS walks you there.
        </p>
      </div>
      <Tabs defaultValue={tab}>
        <div
          className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
          data-tour="help-tabs"
        >
          <TabsList className="h-12 rounded-xl">
            <TabsTrigger value="how" className={tabCls}>How do I…</TabsTrigger>
            <TabsTrigger value="practise" className={tabCls}>Try it out</TabsTrigger>
            <TabsTrigger value="tests" className={tabCls}>Test plan</TabsTrigger>
            <TabsTrigger value="reference" className={tabCls}>What things mean</TabsTrigger>
            <TabsTrigger value="new" className={tabCls}>What&rsquo;s new</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="how"><HowTo /></TabsContent>
        <TabsContent value="practise"><Practice testMode={testMode} /></TabsContent>
        <TabsContent value="tests"><TestPlan initial={results} /></TabsContent>
        <TabsContent value="reference"><Reference /></TabsContent>
        <TabsContent value="new"><WhatsNew releases={releases} reports={reports} /></TabsContent>
      </Tabs>
    </div>
  );
}
