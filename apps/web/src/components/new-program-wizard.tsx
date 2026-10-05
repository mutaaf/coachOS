"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/ui/copy-button";
import { useAction } from "@/lib/use-action";
import { createProgramEverywhere, type Created } from "@/lib/actions/new-program";
import {
  addSchool,
  AGE_GROUPS,
  cardPreview,
  DAY_NAMES,
  DEFAULT_SLOT,
  draftForNextSeason,
  draftForProgram,
  emptyDraft,
  programFacts,
  removeSchool,
  resolvedSessions,
  searchSchools,
  seasonFacts,
  slotText,
  SPORTS,
  STEPS,
  stepProblems,
  updateSchool,
  warnings,
  type CardPreview,
  type Draft,
  type FlowContext,
  type Slot,
  type Step,
} from "@/lib/new-program";
import { focalPosition } from "@/lib/site-media";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Globe, ImageOff, MapPin, Plus, Search, X } from "lucide-react";

/**
 * New program: pick or make a program, put it on at one or more schools with
 * its season and weekly times, open sign-ups and put it on the website — then
 * one save does all of it (ops.create_program_sessions). Also "Add to another
 * school" (?program=) and "Duplicate for next season" (?program=&from=).
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://risingstars.training").replace(/\/$/, "");

export function NewProgramWizard({
  ctx,
  programId,
  fromSeasonId,
}: {
  ctx: FlowContext;
  programId: string | null;
  fromSeasonId: string | null;
}) {
  const known = programId && ctx.catalog.some((c) => c.id === programId) ? programId : null;
  const mode: "new" | "add" | "duplicate" = known ? (fromSeasonId ? "duplicate" : "add") : "new";
  const [draft, setDraft] = useState<Draft>(() =>
    known && fromSeasonId ? draftForNextSeason(ctx, known, fromSeasonId) : known ? draftForProgram(ctx, known) : emptyDraft(ctx)
  );
  const [step, setStep] = useState<Step>(known ? "where" : "program");
  const [tried, setTried] = useState<Partial<Record<Step, boolean>>>({});
  const [created, setCreated] = useState<Created | null>(null);
  const { run, pending } = useAction();

  const at = STEPS.findIndex((s) => s.id === step);
  const card = cardPreview(draft, ctx);
  const facts = programFacts(draft, ctx);
  const heading =
    mode === "duplicate" ? `${facts.name} — next season` : mode === "add" ? `Add ${facts.name} to another school` : "New program";

  function go(to: Step) {
    const target = STEPS.findIndex((s) => s.id === to);
    // Forward only past steps that are fine; back any time.
    for (let i = 0; i < target; i++) {
      if (stepProblems(draft, ctx, STEPS[i].id).length) {
        setTried((t) => ({ ...t, [STEPS[i].id]: true }));
        setStep(STEPS[i].id);
        return;
      }
    }
    setStep(to);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setTried({ program: true, where: true, website: true });
    const wrong = STEPS.find((s) => stepProblems(draft, ctx, s.id).length);
    if (wrong) return setStep(wrong.id);
    let result: Created | null = null;
    const n = draft.schools.length;
    await run(
      async () => {
        const res = await createProgramEverywhere(draft);
        if ("created" in res && res.created) result = res.created;
        return res;
      },
      {
        success: `${facts.name} is on at ${n} ${n === 1 ? "school" : "schools"}${draft.website.show ? " and on the website" : ""}`,
        error: "Nothing was saved",
      }
    );
    if (result) setCreated(result);
  }

  if (created) return <Done draft={draft} ctx={ctx} created={created} name={facts.name} />;

  const shown = tried[step] ? stepProblems(draft, ctx, step) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/programs" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted sm:h-10 sm:w-10" aria-label="Back to Programs">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="min-w-0 break-words text-xl font-bold leading-tight sm:text-2xl">{heading}</h1>
      </div>

      <ol className="mb-5 grid grid-cols-3 gap-1.5 sm:gap-2" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < at && stepProblems(draft, ctx, s.id).length === 0;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go(s.id)}
                aria-current={s.id === step ? "step" : undefined}
                className={`flex h-full min-h-[48px] w-full flex-col items-start justify-center rounded-xl border px-2.5 py-1.5 text-left transition-colors sm:px-3 ${
                  s.id === step ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
                }`}
              >
                <span className={`flex items-center gap-1 text-xs font-semibold ${s.id === step ? "text-primary" : "text-muted-foreground"}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : `${i + 1}`}
                  <span className="sr-only">. </span>
                </span>
                <span className="text-[13px] font-medium leading-tight sm:text-sm">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          className="min-w-0 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === "website") save();
            else {
              setTried((t) => ({ ...t, [step]: true }));
              if (stepProblems(draft, ctx, step).length === 0) go(STEPS[at + 1].id);
            }
          }}
          noValidate
          data-testid="new-program-form"
        >
          {step === "program" && <ProgramStep draft={draft} setDraft={setDraft} ctx={ctx} />}
          {step === "where" && <WhereStep draft={draft} setDraft={setDraft} ctx={ctx} />}
          {step === "website" && <WebsiteStep draft={draft} setDraft={setDraft} ctx={ctx} card={card} />}

          {shown.length > 0 && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <ul className="list-disc space-y-0.5 pl-5">
                {shown.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            {at > 0 && (
              <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => go(STEPS[at - 1].id)}>
                Back
              </Button>
            )}
            <Button type="submit" className="h-11 flex-1 sm:h-10 sm:flex-none" disabled={pending} data-testid="wizard-next">
              {step !== "website" ? "Next" : pending ? "Saving…" : saveLabel(draft)}
            </Button>
          </div>
        </form>

        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On the website</p>
            {draft.website.show ? (
              <CardPreviewView card={card} />
            ) : (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Not shown on the website.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function saveLabel(d: Draft) {
  const n = d.schools.length;
  return `Save — ${n} ${n === 1 ? "school" : "schools"}`;
}

type StepProps = { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; ctx: FlowContext };

/* ------------------------------------------------------------------------- */
/* 1. The program                                                            */
/* ------------------------------------------------------------------------- */

function ProgramStep({ draft, setDraft, ctx }: StepProps) {
  const active = ctx.catalog.filter((c) => c.status === "active");
  const [query, setQuery] = useState("");
  const p = draft.program;
  const choose = (mode: "existing" | "new") =>
    setDraft((d) => ({
      ...d,
      program:
        mode === "existing"
          ? { mode: "existing", id: d.program.mode === "existing" ? d.program.id : "" }
          : { mode: "new", name: "", sport: "basketball", ages: [], description: "", fee: "", capacity: "12" },
    }));
  const setNew = (patch: Partial<Extract<Draft["program"], { mode: "new" }>>) =>
    setDraft((d) => (d.program.mode === "new" ? { ...d, program: { ...d.program, ...patch } } : d));
  const matches = active.filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="space-y-4" aria-labelledby="step-program">
      <h2 id="step-program" className="sr-only">Program</h2>
      {active.length > 0 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Which program">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={p.mode === m}
              onClick={() => choose(m)}
              className={`h-10 rounded-lg text-sm font-medium ${p.mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "existing" ? `One of my programs (${active.length})` : "+ A new program"}
            </button>
          ))}
        </div>
      )}

      {p.mode === "existing" ? (
        <div className="space-y-3">
          {active.length > 5 && (
            <div className="relative">
              <Label htmlFor="program-search" className="sr-only">Find a program</Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="program-search" className="pl-9" placeholder="Find a program" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Programs">
            {matches.map((c) => {
              const on = p.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, program: { mode: "existing", id: c.id } }))}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:bg-muted/50"}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{c.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {[c.sport, c.age_groups.join(", "), `${formatCurrency(c.default_monthly_fee)}/mo`, `${c.default_capacity} places`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && <li className="text-sm text-muted-foreground">No program matches “{query}”.</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Program name</Label>
            <Input id="np-name" value={p.name} onChange={(e) => setNew({ name: e.target.value })} placeholder="Lil Dribblers (K–1)" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="np-sport">Sport</Label>
              <Select
                id="np-sport"
                value={SPORTS.includes(p.sport) ? p.sport : "__other"}
                onChange={(e) => setNew({ sport: e.target.value === "__other" ? "" : e.target.value })}
                options={[...SPORTS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), { value: "__other", label: "Something else…" }]}
              />
            </div>
            {!SPORTS.includes(p.sport) && (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="np-sport-other">Which sport</Label>
                <Input id="np-sport-other" value={p.sport} onChange={(e) => setNew({ sport: e.target.value })} placeholder="Cheer" />
              </div>
            )}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Ages</legend>
            <div className="flex flex-wrap gap-2">
              {AGE_GROUPS.map((a) => {
                const on = p.ages.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setNew({ ages: on ? p.ages.filter((x) => x !== a) : [...p.ages, a] })}
                    className={`h-11 rounded-full border px-4 text-sm sm:h-10 sm:px-3 ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="np-description">Description for parents</Label>
            <Textarea id="np-description" rows={3} value={p.description} onChange={(e) => setNew({ description: e.target.value })} placeholder="Ball-handling, footwork and fun for our youngest players." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-fee">Usual monthly fee</Label>
              <Input id="np-fee" inputMode="decimal" value={p.fee} onChange={(e) => setNew({ fee: e.target.value })} placeholder="120" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-capacity">Usual places</Label>
              <Input id="np-capacity" inputMode="numeric" value={p.capacity} onChange={(e) => setNew({ capacity: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Each school starts with these; you can change them per school in the next step.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* 2. Schools, season and weekly times                                       */
/* ------------------------------------------------------------------------- */

function WhereStep({ draft, setDraft, ctx }: StepProps) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const found = useMemo(() => searchSchools(ctx.schools, query, draft.schools).slice(0, query ? 8 : 6), [ctx.schools, query, draft.schools]);
  const facts = programFacts(draft, ctx);
  const season = seasonFacts(draft, ctx);
  const open = ctx.seasons.filter((s) => s.status !== "closed");
  const seasonValue = draft.season.mode === "existing" ? draft.season.id : draft.season.mode === "new" ? "__new" : "__none";

  function addNew() {
    if (!newName.trim()) return;
    setDraft((d) => addSchool(d, { id: null, name: newName, address: newAddress }));
    setNewName("");
    setNewAddress("");
    setAdding(false);
  }

  return (
    <section className="space-y-6" aria-labelledby="step-where">
      <h2 id="step-where" className="sr-only">Schools and times</h2>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Schools</legend>
        {draft.schools.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Chosen schools">
            {draft.schools.map((s) => (
              <li key={s.key} className="flex max-w-full items-center gap-1 rounded-full border border-primary bg-primary/5 py-1 pl-3 pr-1 text-sm">
                <span className="min-w-0 truncate font-medium">{s.name}</span>
                {!s.id && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 text-[11px] font-semibold text-sky-800">new</span>}
                <button
                  type="button"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => setDraft((d) => removeSchool(d, s.key))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-primary/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <Label htmlFor="school-search" className="sr-only">Find a school</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="school-search" className="pl-9" placeholder={ctx.schools.length ? "Find a school" : "No schools yet — add one below"} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {found.length > 0 && (
          <ul className="divide-y rounded-xl border bg-card" aria-label="Schools to add">
            {found.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft((d) => addSchool(d, s));
                    setQuery("");
                  }}
                  className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
                  aria-label={`Add ${s.name}`}
                >
                  <Plus className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[s.address, s.usualSlots.length ? `usually ${s.usualSlots.map(slotText).join(", ")}` : null].filter(Boolean).join(" · ") || "No address yet"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query && found.length === 0 && !adding && <p className="text-sm text-muted-foreground">No school matches “{query}”.</p>}
        {adding ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-school-name">New school’s name</Label>
              <Input id="new-school-name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNew())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-school-address">Address</Label>
              <Input id="new-school-address" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Street, city — shown to parents on the website" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNew())} />
            </div>
            <div className="flex gap-2">
              <Button type="button" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={addNew} disabled={!newName.trim()}>
                Add school
              </Button>
              <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:h-10 sm:w-auto"
            onClick={() => {
              setAdding(true);
              setNewName(query);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> New school
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Season and dates</legend>
        <div className="space-y-1.5">
          <Label htmlFor="np-season">Season</Label>
          <Select
            id="np-season"
            value={seasonValue}
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => ({
                ...d,
                season: v === "__new" ? { mode: "new", name: "", start: "", end: "" } : v === "__none" ? { mode: "none" } : { mode: "existing", id: v },
              }));
            }}
            options={[
              ...open.map((s) => ({ value: s.id, label: `${s.name}${s.status === "upcoming" ? " (upcoming)" : ""}` })),
              { value: "__new", label: "+ A new season" },
              { value: "__none", label: "No season" },
            ]}
          />
        </div>
        {draft.season.mode === "new" && (
          <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="np-season-name">New season’s name</Label>
              <Input
                id="np-season-name"
                value={draft.season.name}
                placeholder="Spring 2027"
                onChange={(e) => setDraft((d) => (d.season.mode === "new" ? { ...d, season: { ...d.season, name: e.target.value } } : d))}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="np-season-start">Season starts</Label>
              <Input
                id="np-season-start"
                type="date"
                value={draft.season.start}
                onChange={(e) => setDraft((d) => (d.season.mode === "new" ? { ...d, season: { ...d.season, start: e.target.value } } : d))}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="np-season-end">Season ends</Label>
              <Input
                id="np-season-end"
                type="date"
                value={draft.season.end}
                onChange={(e) => setDraft((d) => (d.season.mode === "new" ? { ...d, season: { ...d.season, end: e.target.value } } : d))}
              />
            </div>
          </div>
        )}
        {draft.season.mode !== "new" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="np-start">Starts</Label>
              <Input id="np-start" type="date" value={draft.startDate || season.start || ""} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="np-end">Ends</Label>
              <Input id="np-end" type="date" value={draft.endDate || season.end || ""} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Weekly practices</legend>
        <SlotsEditor id="shared" slots={draft.slots} onChange={(slots) => setDraft((d) => ({ ...d, slots }))} />
        <div className="space-y-1.5">
          <Label htmlFor="np-location">Where at the school (optional)</Label>
          <Input id="np-location" value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} placeholder="Gym, Court 2…" />
        </div>
      </fieldset>

      {draft.schools.length > 0 && <PerSchool draft={draft} setDraft={setDraft} ctx={ctx} defaults={{ fee: facts.fee, capacity: facts.capacity }} />}
    </section>
  );
}

function SlotsEditor({ id, slots, onChange }: { id: string; slots: Slot[]; onChange: (s: Slot[]) => void }) {
  const set = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      {slots.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_auto]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <Label htmlFor={`${id}-day-${i}`} className="sr-only">Day</Label>
            <Select id={`${id}-day-${i}`} aria-label="Day" value={String(s.dow)} onChange={(e) => set(i, { dow: Number(e.target.value) })} options={DAY_NAMES.map((d, n) => ({ value: String(n), label: d }))} />
          </div>
          <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] gap-2 sm:contents">
            <div className="min-w-0">
              <Label htmlFor={`${id}-from-${i}`} className="sr-only">Starts at</Label>
              <Input id={`${id}-from-${i}`} aria-label="Starts at" type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} />
            </div>
            <div className="min-w-0">
              <Label htmlFor={`${id}-to-${i}`} className="sr-only">Ends at</Label>
              <Input id={`${id}-to-${i}`} aria-label="Ends at" type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} />
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${DAY_NAMES[s.dow]} practice`} onClick={() => onChange(slots.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:h-10"
        onClick={() => {
          const last = slots[slots.length - 1];
          // The same time two days later (Tue → Thu) is the usual second practice.
          onChange([...slots, last ? { ...last, dow: (last.dow + 2) % 7 } : DEFAULT_SLOT]);
        }}
      >
        <Plus className="mr-1 h-4 w-4" /> {slots.length ? "Another practice" : "Add a weekly practice"}
      </Button>
    </div>
  );
}

function PerSchool({ draft, setDraft, ctx, defaults }: StepProps & { defaults: { fee: number; capacity: number } }) {
  const sessions = resolvedSessions(draft, ctx);
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Per school</legend>
      <p className="text-sm text-muted-foreground">Leave a box empty to use the program’s usual {formatCurrency(defaults.fee)}/mo and {defaults.capacity} places.</p>
      <div className="space-y-2" data-testid="per-school">
        {draft.schools.map((s, i) => {
          const r = sessions[i];
          return (
            <div key={s.key} className="rounded-xl border bg-card p-3" data-testid="per-school-row">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{s.name}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{r.slots.map(slotText).join(", ") || "No weekly time"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6.5rem_5.5rem_minmax(0,1fr)]">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`fee-${s.key}`} className="text-xs text-muted-foreground">Fee / mo<span className="sr-only"> at {s.name}</span></Label>
                  <Input id={`fee-${s.key}`} inputMode="decimal" placeholder={String(defaults.fee)} value={s.fee} onChange={(e) => setDraft((d) => updateSchool(d, s.key, { fee: e.target.value }))} />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`cap-${s.key}`} className="text-xs text-muted-foreground">Places<span className="sr-only"> at {s.name}</span></Label>
                  <Input id={`cap-${s.key}`} inputMode="numeric" placeholder={String(defaults.capacity)} value={s.capacity} onChange={(e) => setDraft((d) => updateSchool(d, s.key, { capacity: e.target.value }))} />
                </div>
                <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                  <Label htmlFor={`coach-${s.key}`} className="text-xs text-muted-foreground">Coach<span className="sr-only"> at {s.name}</span></Label>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        id={`coach-${s.key}`}
                        value={s.coachId}
                        onChange={(e) => setDraft((d) => updateSchool(d, s.key, { coachId: e.target.value }))}
                        options={[{ value: "", label: ctx.coaches.length ? "No coach yet" : "No coaches yet" }, ...ctx.coaches.map((c) => ({ value: c.id, label: c.name }))]}
                      />
                    </div>
                    {/*
                      TODO(compliance): show <CoachClearanceBadge coachId={s.coachId} /> here (from
                      getCoachClearance, being added on feat/compliance). Leave this slot in place;
                      it keeps the coach picker's layout ready for the badge.
                    */}
                    <span data-slot="coach-clearance" data-coach-id={s.coachId || undefined} className="empty:hidden" />
                  </div>
                </div>
              </div>
              <div className="mt-2">
                {s.slots === null ? (
                  <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setDraft((d) => updateSchool(d, s.key, { slots: [...d.slots] }))}>
                    Different times at {s.name}
                  </button>
                ) : (
                  <div className="space-y-2 rounded-lg bg-muted/40 p-2">
                    <p className="text-xs font-medium text-muted-foreground">Times at {s.name}</p>
                    <SlotsEditor id={`slots-${i}`} slots={s.slots} onChange={(slots) => setDraft((d) => updateSchool(d, s.key, { slots }))} />
                    <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setDraft((d) => updateSchool(d, s.key, { slots: null }))}>
                      Use the times above
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------------- */
/* 3. Sign-ups and the website                                               */
/* ------------------------------------------------------------------------- */

function WebsiteStep({ draft, setDraft, ctx, card }: StepProps & { card: CardPreview }) {
  const facts = programFacts(draft, ctx);
  const w = draft.website;
  const setWeb = (patch: Partial<Draft["website"]>) => setDraft((d) => ({ ...d, website: { ...d.website, ...patch } }));
  const notes = warnings(draft, ctx);
  const n = draft.schools.length;

  return (
    <section className="space-y-5" aria-labelledby="step-website">
      <h2 id="step-website" className="sr-only">Sign-ups and website</h2>

      <div className="divide-y rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 p-3">
          <div>
            <Label htmlFor="np-open" className="text-base">Open for sign-ups now</Label>
            <p className="text-sm text-muted-foreground">Parents can register on the website and the sign-up link.</p>
          </div>
          <Switch id="np-open" checked={draft.registrationOpen} onCheckedChange={(c) => setDraft((d) => ({ ...d, registrationOpen: c }))} />
        </div>
        <div className="flex items-center justify-between gap-3 p-3">
          <div>
            <Label htmlFor="np-web" className="text-base">Show on the website</Label>
            <p className="text-sm text-muted-foreground">One card per school at risingstars.training. Live within a minute — no deploy.</p>
          </div>
          <Switch id="np-web" checked={w.show} onCheckedChange={(c) => setWeb({ show: c })} />
        </div>
      </div>

      {w.show && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np-web-title">Title on the website</Label>
            <Input id="np-web-title" value={w.title} onChange={(e) => setWeb({ title: e.target.value })} placeholder={facts.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-web-description">Description on the website</Label>
            <Textarea id="np-web-description" rows={3} value={w.description} onChange={(e) => setWeb({ description: e.target.value })} placeholder={facts.description || "What parents read first."} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Photo</legend>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Photo">
              <button
                type="button"
                role="radio"
                aria-checked={!w.mediaId}
                onClick={() => setWeb({ mediaId: null })}
                className={`flex h-20 w-28 shrink-0 flex-col items-center justify-center rounded-lg border text-center text-xs text-muted-foreground ${!w.mediaId ? "border-primary ring-2 ring-primary" : ""}`}
              >
                <ImageOff className="mb-1 h-4 w-4" /> The sport’s photo
              </button>
              {ctx.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={w.mediaId === p.id}
                  aria-label={p.alt || "Photo without a description"}
                  onClick={() => setWeb({ mediaId: p.id })}
                  className={`relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border ${w.mediaId === p.id ? "border-primary ring-2 ring-primary" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className="h-full w-full object-cover" style={{ objectPosition: focalPosition(p.focal_x, p.focal_y) }} loading="lazy" />
                  {!p.live && <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 text-[10px] font-medium text-white">Not published</span>}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Photos come from the <Link href="/website?tab=photos" className="font-medium text-primary underline-offset-4 hover:underline" target="_blank">Photos library on the Website page</Link>.
            </p>
          </fieldset>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="np-featured" className="font-normal">Feature it on the website</Label>
            <Switch id="np-featured" checked={w.featured} onCheckedChange={(c) => setWeb({ featured: c })} />
          </div>
          <div className="lg:hidden">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            <CardPreviewView card={card} />
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-muted/30 p-3 text-sm" data-testid="review">
        <p className="font-medium">Saving will:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>{draft.program.mode === "new" ? `make the program ${facts.name || "…"}` : `use ${facts.name}`}</li>
          {draft.season.mode === "new" && <li>make the season {draft.season.name || "…"}</li>}
          {draft.schools.some((s) => !s.id) && <li>add {draft.schools.filter((s) => !s.id).map((s) => s.name).join(", ")} to your schools</li>}
          <li>
            put it on at {n} {n === 1 ? "school" : "schools"}, {draft.registrationOpen ? "open for sign-ups" : "closed for sign-ups"}
          </li>
          {w.show && <li>add {n === 1 ? "its card" : `${n} cards`} to the website</li>}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">All of it or none of it — nothing is half-made if something goes wrong.</p>
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1.5" aria-label="Worth knowing">
          {notes.map((t) => (
            <li key={t} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The program's card as the website will show it. */
export function CardPreviewView({ card }: { card: CardPreview }) {
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm" data-testid="card-preview" aria-label="Website card preview">
      <div className="relative aspect-[16/9] bg-gradient-to-br from-slate-200 to-slate-300">
        {card.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photo.thumb} alt={card.photo.alt} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: focalPosition(card.photo.focal_x, card.photo.focal_y) }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-slate-600">
            {card.sport ? `The ${card.sport} photo from the library goes here` : "The sport’s photo goes here"}
          </div>
        )}
        <span className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold text-white ${card.registrationOpen ? "bg-emerald-600" : "bg-slate-600"}`}>
          {card.registrationOpen ? "Registration open" : "Registration closed"}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="break-words text-lg font-bold leading-snug">{card.title}</h3>
        {card.ages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.ages.map((a) => (
              <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{a}</span>
            ))}
          </div>
        )}
        {card.description && <p className="line-clamp-3 text-sm text-muted-foreground">{card.description}</p>}
        {card.dates && <p className="text-sm font-medium">{card.dates}</p>}
        <ul className="space-y-1.5 border-t pt-2">
          {card.places.map((p) => (
            <li key={p.school} className="text-sm">
              <span className="flex items-start gap-1 font-medium">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.school}
              </span>
              <span className="block pl-[1.125rem] text-muted-foreground">
                {p.times} · {p.price} · {p.spots}
              </span>
            </li>
          ))}
          {card.places.length === 0 && <li className="text-sm text-muted-foreground">Pick a school to see its card.</li>}
        </ul>
        <div className={`mt-1 flex h-10 items-center justify-center rounded-lg text-sm font-semibold ${card.registrationOpen ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} aria-hidden>
          {card.registrationOpen ? "Register" : "Join the waitlist"}
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------------- */
/* Saved                                                                     */
/* ------------------------------------------------------------------------- */

function Done({ draft, ctx, created, name }: { draft: Draft; ctx: FlowContext; created: Created; name: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const season = seasonFacts(draft, ctx).name;
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="new-program-done">
      <div className="rounded-2xl border bg-emerald-50 p-5">
        <p className="flex items-center gap-2 text-lg font-bold text-emerald-900">
          <Check className="h-5 w-5" /> {name} is on at {created.sessions.length} {created.sessions.length === 1 ? "school" : "schools"}
        </p>
        <p className="mt-1 text-sm text-emerald-900/80">
          {[season, draft.registrationOpen ? "open for sign-ups" : "sign-ups closed"].filter(Boolean).join(" · ")}
          {draft.website.show ? " · on the website within a minute" : ""}
        </p>
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {created.sessions.map((s) => {
          const link = `${origin}/join/${s.public_slug}`;
          return (
            <li key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{s.school_name}</p>
                <p className="truncate text-sm text-muted-foreground">Sign-up link: /join/{s.public_slug}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <CopyButton value={link} label="Copy link" />
                <Link href={`/schools/${s.school_id}`} className="inline-flex h-10 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">
                  School
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link href="/programs" className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground sm:h-10">
          Back to Programs
        </Link>
        <Link href={`/programs/new?program=${created.catalog_id}`} className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted sm:h-10">
          <Plus className="mr-1 h-4 w-4" /> Add to another school
        </Link>
        {draft.website.show && (
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border px-4 text-sm font-medium hover:bg-muted sm:h-10">
            <Globe className="h-4 w-4" /> Open the website <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
