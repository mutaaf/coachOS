"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/lib/use-action";
import { saveCatalogProgram, saveSeason, setCatalogProgramArchived } from "@/lib/actions/catalog";
import { setRegistrationOpen } from "@/lib/actions/new-program";
import type { CatalogProgram, Season } from "@/lib/queries/catalog";
import { formatCurrency } from "@/lib/utils";
import { CalendarRange, ChevronRight, Copy, Lock, LockOpen, Pencil, Plus, Users } from "lucide-react";

/**
 * Programs: what she offers, made once — and where each is on. A program put
 * on at a school in a season is a session; a session's dates are practices.
 */

const AGES = ["4-6 years", "7-9 years", "10-12 years", "13+ years"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function when(start: string | null, end: string | null) {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start && end) return `${f(start)} – ${f(end)}`;
  if (start) return `from ${f(start)}`;
  return "";
}

export function ProgramsPageClient({
  programs,
  seasons,
}: {
  programs: CatalogProgram[];
  seasons: Season[];
  schools: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<CatalogProgram | "new" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const bulk = useAction();
  const [seasonEditing, setSeasonEditing] = useState<Season | "new" | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<string>("current");
  const [showArchived, setShowArchived] = useState(false);

  const current = seasons.filter((s) => s.status !== "closed");
  const inFilter = (seasonId: string | null) =>
    seasonFilter === "all" ? true : seasonFilter === "current" ? !seasonId || current.some((s) => s.id === seasonId) : seasonId === seasonFilter;
  const shown = programs.filter((p) => showArchived || p.status === "active");
  /** The most recent season this program ran in — what "Duplicate for next season" copies. */
  const latestSeason = (p: CatalogProgram) => {
    const ids = new Set(p.sessions.map((s) => s.season_id).filter(Boolean));
    return seasons.find((s) => ids.has(s.id)) ?? null;
  };
  const visibleIds = new Set(shown.flatMap((p) => p.sessions.filter((s) => inFilter(s.season_id)).map((s) => s.id)));
  const selected = [...picked].filter((id) => visibleIds.has(id));
  async function bulkSignups(open: boolean) {
    const ok = await bulk.run(() => setRegistrationOpen(selected, open), {
      success: `Sign-ups ${open ? "opened" : "closed"} for ${selected.length} ${selected.length === 1 ? "session" : "sessions"}`,
      error: "Not changed",
    });
    if (ok) setPicked(new Set());
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Programs</h1>
          <p className="text-sm text-muted-foreground sm:text-base">What you offer, and where each one is on.</p>
        </div>
        <Link
          href="/programs/new"
          data-testid="new-program"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:h-10 sm:w-auto"
        >
          <Plus className="mr-1 h-4 w-4" /> New program
        </Link>
      </div>

      <Tabs defaultValue="programs">
        <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-12 w-max sm:h-10" data-tour="programs-tabs">
            <TabsTrigger value="programs" className="h-10 px-4 sm:h-8 sm:px-3">Programs ({programs.filter((p) => p.status === "active").length})</TabsTrigger>
            <TabsTrigger value="seasons" className="h-10 px-4 sm:h-8 sm:px-3">Seasons ({seasons.length})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="programs" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="season-filter" className="sr-only">Season</Label>
            <div className="w-full sm:w-64">
              <Select
                id="season-filter"
                value={seasonFilter}
                onChange={(e) => setSeasonFilter(e.target.value)}
                options={[
                  { value: "current", label: "This season and next" },
                  { value: "all", label: "Every season" },
                  ...seasons.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4" />
              Show archived
            </label>
          </div>

          {shown.length === 0 && (
            <div className="rounded-2xl border border-dashed p-6 text-center sm:p-8">
              <p className="font-medium">No programs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Tap New program — pick the schools, the season and the times, and put it on the website in one go.
              </p>
            </div>
          )}

          {selected.length > 0 && (
            <div
              className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
              data-testid="bulk-signups"
              role="region"
              aria-label="Selected sessions"
            >
              <span className="px-2 text-sm font-medium tabular-nums">{selected.length} selected</span>
              <Button className="h-11 sm:h-9" disabled={bulk.pending} onClick={() => bulkSignups(true)}>
                <LockOpen className="mr-1 h-4 w-4" /> Open sign-ups
              </Button>
              <Button variant="outline" className="h-11 sm:h-9" disabled={bulk.pending} onClick={() => bulkSignups(false)}>
                <Lock className="mr-1 h-4 w-4" /> Close sign-ups
              </Button>
              <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((p) => {
              const sessions = p.sessions.filter((s) => inFilter(s.season_id));
              return (
                <article key={p.id} data-testid="program" className={`min-w-0 rounded-2xl border bg-card ${p.status === "archived" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3 p-4 pb-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-lg font-semibold leading-snug">{p.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {[p.age_groups.join(", "), `${formatCurrency(p.default_monthly_fee)}/mo`, `${p.default_capacity} places`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" className="-mr-2 -mt-1.5 h-11 w-11 shrink-0" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  <ul className="divide-y border-t" aria-label={`Sessions of ${p.name}`}>
                    {sessions.map((s) => (
                      <li key={s.id} className="flex items-stretch">
                        <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center hover:bg-muted/50" title="Select for sign-ups">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            aria-label={`Select ${s.school_name}`}
                            checked={picked.has(s.id)}
                            onChange={(e) =>
                              setPicked((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(s.id);
                                else next.delete(s.id);
                                return next;
                              })
                            }
                          />
                        </label>
                        <Link
                          href={`/schools/${s.school_id}`}
                          data-testid="session"
                          className="grid min-h-[56px] min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2 py-2.5 pr-4 hover:bg-muted/50 sm:gap-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{s.school_name}</span>
                            <span className="block text-sm text-muted-foreground sm:truncate">
                              {[s.times.join(", ") || "No weekly time yet", s.season_name, when(s.start_date, s.end_date)].filter(Boolean).join(" · ")}
                            </span>
                            <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${s.registration_open ? "text-emerald-700" : "text-muted-foreground"}`}>
                              {s.registration_open ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                              {s.registration_open ? "Sign-ups open" : "Sign-ups closed"}
                            </span>
                          </span>
                          <span
                            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                              s.enrolled === 0 ? "bg-muted text-muted-foreground" : s.enrolled >= s.capacity ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"
                            }`}
                          >
                            <Users className="h-3 w-3" /> {s.enrolled === 0 ? "No roster yet" : `${s.enrolled}/${s.capacity}`}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                    {sessions.length === 0 && (
                      <li className="px-4 py-3 text-sm text-muted-foreground">Not on anywhere {seasonFilter === "all" ? "" : "this season"} yet.</li>
                    )}
                  </ul>
                  {p.status === "active" && (
                    <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:flex-wrap">
                      <Link
                        href={`/programs/new?program=${p.id}`}
                        className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted sm:h-10"
                      >
                        <Plus className="mr-1 h-4 w-4" /> Add to another school
                      </Link>
                      {latestSeason(p) && (
                        <Link
                          href={`/programs/new?program=${p.id}&from=${latestSeason(p)!.id}`}
                          className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted sm:h-10"
                        >
                          <Copy className="mr-1 h-4 w-4" /> Duplicate {latestSeason(p)!.name} for next season
                        </Link>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="seasons" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setSeasonEditing("new")} className="h-11 w-full sm:h-10 sm:w-auto">
              <Plus className="mr-1 h-4 w-4" /> New season
            </Button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {seasons.map((s) => (
              <li key={s.id} className="rounded-2xl border bg-card p-4" data-testid="season">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">{s.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {when(s.start_date, s.end_date) || "No dates yet"} · {s.sessionCount} {s.sessionCount === 1 ? "session" : "sessions"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.status === "active" ? "bg-emerald-50 text-emerald-800" : s.status === "upcoming" ? "bg-sky-50 text-sky-800" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {s.status === "active" ? "On now" : s.status === "upcoming" ? "Upcoming" : "Closed"}
                  </span>
                </div>
                {s.no_class_dates.length > 0 && (
                  <p className="mt-2 text-sm">
                    <CalendarRange className="mr-1 inline h-4 w-4 text-muted-foreground" />
                    No practice: {s.no_class_dates.map((d) => when(d, null).replace("from ", "")).join(", ")}
                  </p>
                )}
                <Button variant="outline" className="mt-3 h-11 sm:h-9" onClick={() => setSeasonEditing(s)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              </li>
            ))}
            {seasons.length === 0 && (
              <li className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground sm:col-span-2">
                No seasons yet. Make one — like “Fall 2026” — with its dates and any days off.
              </li>
            )}
          </ul>
        </TabsContent>
      </Tabs>

      {editing && <ProgramDialog program={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {seasonEditing && <SeasonDialog season={seasonEditing === "new" ? null : seasonEditing} onClose={() => setSeasonEditing(null)} />}
    </div>
  );
}

function ProgramDialog({ program, onClose }: { program: CatalogProgram | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [ages, setAges] = useState<string[]>(program?.age_groups ?? []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (program) fd.set("id", program.id);
    ages.forEach((a) => fd.append("age_groups", a));
    const ok = await run(() => saveCatalogProgram(fd), { success: program ? "Saved" : "Program made — now add it to a school", error: "Not saved" });
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="program-dialog" onClose={onClose}>
        <DialogHeader className="mb-4 pr-8 text-left">
          <DialogTitle>{program ? "Edit program" : "New program"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="program-name">Name</Label>
            <Input id="program-name" name="name" defaultValue={program?.name} placeholder="Lil Dribblers (K–1)" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-description">Description for parents</Label>
            <Textarea id="program-description" name="description" rows={3} defaultValue={program?.description} placeholder="Ball-handling, footwork and fun for our youngest players." />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Ages</legend>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...AGES, ...ages])].map((a) => {
                const on = ages.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAges(on ? ages.filter((x) => x !== a) : [...ages, a])}
                    className={`h-11 rounded-full border px-4 text-sm sm:h-10 sm:px-3 ${on ? "border-primary bg-primary text-primary-foreground" : "bg-white"}`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="program-fee">Usual monthly fee</Label>
              <Input id="program-fee" name="default_monthly_fee" inputMode="decimal" defaultValue={program?.default_monthly_fee ?? ""} placeholder="120" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-capacity">Usual places</Label>
              <Input id="program-capacity" name="default_capacity" inputMode="numeric" defaultValue={program?.default_capacity ?? 12} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Each session starts with these, and can change them.</p>
          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:justify-between">
            {program ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-muted-foreground sm:h-10"
                onClick={async () => {
                  const ok = await run(() => setCatalogProgramArchived(program.id, program.status === "active"), {
                    success: program.status === "active" ? "Archived — its sessions keep running" : "Back in your programs",
                    error: "Not changed",
                  });
                  if (ok) onClose();
                }}
              >
                {program.status === "active" ? "Archive" : "Bring back"}
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="h-11 sm:h-10">
                {pending ? "Saving…" : program ? "Save" : "Make program"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SeasonDialog({ season, onClose }: { season: Season | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const [days, setDays] = useState<string[]>(season?.no_class_dates ?? []);
  const [day, setDay] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (season) fd.set("id", season.id);
    fd.set("no_class_dates", days.join(","));
    const ok = await run(() => saveSeason(fd), { success: "Saved", error: "Not saved" });
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="season-dialog" onClose={onClose}>
        <DialogHeader className="mb-4 pr-8 text-left">
          <DialogTitle>{season ? `Edit ${season.name}` : "New season"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="season-name">Name</Label>
            <Input id="season-name" name="name" defaultValue={season?.name} placeholder="Fall 2026" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="season-start">Starts</Label>
              <Input id="season-start" name="start_date" type="date" defaultValue={season?.start_date ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="season-end">Ends</Label>
              <Input id="season-end" name="end_date" type="date" defaultValue={season?.end_date ?? ""} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="season-status">Status</Label>
            <Select
              id="season-status"
              name="status"
              defaultValue={season?.status ?? "active"}
              options={[
                { value: "upcoming", label: "Upcoming" },
                { value: "active", label: "On now" },
                { value: "closed", label: "Closed" },
              ]}
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Days with no practice (holidays, breaks)</legend>
            <div className="flex gap-2">
              <Label htmlFor="season-day-off" className="sr-only">Day off</Label>
              <Input id="season-day-off" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-10" disabled={!day} onClick={() => { setDays([...new Set([...days, day])].sort()); setDay(""); }}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(days.filter((x) => x !== d))}
                  className="h-11 rounded-full border bg-white px-3 text-sm sm:h-9"
                  aria-label={`Remove ${d}`}
                >
                  {new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ✕
                </button>
              ))}
            </div>
          </fieldset>
          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-10">
              {pending ? "Saving…" : "Save season"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
