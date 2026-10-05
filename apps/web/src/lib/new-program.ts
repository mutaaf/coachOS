/**
 * The "New program" flow's logic: defaults, checks, the website card preview,
 * and the one payload the database saves in a single transaction
 * (ops.create_program_sessions, migration 20261006000600).
 *
 * Plain functions with no React or database, so the flow's rules are tested
 * directly (tests/integration/new-program.test.ts) and shared by the page and
 * the server action.
 */

import { validLicenseNumber, youthCampCheck, YOUTH_CAMP_BLOCKED, type YouthCampCheck } from "@/lib/youth-camp";

export type Slot = { dow: number; start: string; end: string };

export interface CatalogOption {
  id: string;
  name: string;
  sport: string;
  description: string;
  age_groups: string[];
  default_monthly_fee: number;
  default_capacity: number;
  status: "active" | "archived";
}

export interface SchoolOption {
  id: string;
  name: string;
  address: string | null;
  /** The weekly times of this school's most recent session — its usual slot. */
  usualSlots: Slot[];
}

export interface SeasonOption {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: "upcoming" | "active" | "closed";
}

export interface CoachOption {
  id: string;
  name: string;
}

export interface PhotoOption {
  id: string;
  url: string;
  thumb: string;
  alt: string;
  focal_x: number;
  focal_y: number;
  /** Published and safe to show: it will appear on the site. */
  live: boolean;
}

/** An existing session, for "Add to another school" and "Duplicate for next season". */
export interface ExistingSession {
  id: string;
  catalog_id: string | null;
  school_id: string;
  season_id: string | null;
  monthly_fee: number;
  capacity: number;
  location: string | null;
  coach_id: string | null;
  slots: Slot[];
  registration_open: boolean;
  /** The photo on its website card, if it has its own. */
  media_id?: string | null;
  created_at: string;
}

export interface FlowContext {
  catalog: CatalogOption[];
  schools: SchoolOption[];
  seasons: SeasonOption[];
  coaches: CoachOption[];
  photos: PhotoOption[];
  sessions: ExistingSession[];
  today: string;
}

export interface SchoolPick {
  /** Stable key for the list: the school id, or "new:<name>". */
  key: string;
  id: string | null;
  name: string;
  address: string;
  /** Overrides; "" means "the program's default". */
  fee: string;
  capacity: string;
  coachId: string;
  location: string;
  /** null = the shared weekly schedule. */
  slots: Slot[] | null;
}

export type ProgramChoice =
  | { mode: "existing"; id: string }
  | { mode: "new"; name: string; sport: string; ages: string[]; description: string; fee: string; capacity: string };

export type SeasonChoice =
  | { mode: "existing"; id: string }
  | { mode: "new"; name: string; start: string; end: string }
  | { mode: "none" };

export interface Draft {
  program: ProgramChoice;
  season: SeasonChoice;
  /** The sessions' dates; "" = the season's. */
  startDate: string;
  endDate: string;
  slots: Slot[];
  location: string;
  schools: SchoolPick[];
  registrationOpen: boolean;
  website: { show: boolean; title: string; description: string; mediaId: string | null; featured: boolean };
  /**
   * For a schedule meeting 4+ days in a row (a youth camp under Texas law):
   * the admin's confirmation of a current DSHS youth camp license, and its
   * number. Optional so a draft saved by an older page still reads.
   */
  youthCamp?: { confirmed: boolean; number: string };
}

export const SPORTS = ["basketball", "soccer", "flag football", "volleyball", "tennis", "multi-sport"];
export const AGE_GROUPS = ["4-6 years", "7-9 years", "10-12 years", "13+ years"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_SLOT: Slot = { dow: 2, start: "15:30", end: "16:30" };

/* ------------------------------------------------------------------------- */
/* Small readers                                                              */
/* ------------------------------------------------------------------------- */

/** "120", "$120", "1,200.50" → a number; "" → null (use the default); junk → NaN. */
export function parseMoney(v: string): number | null {
  const t = v.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function parseCount(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
}

const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
const half = (t: string) => (Number(t.split(":")[0]) >= 12 ? "PM" : "AM");

/** "Tue 3:30–4:30 PM" — as the Programs page writes a weekly time. */
export function slotText(s: Slot): string {
  const start = half(s.start) === half(s.end) ? clock(s.start) : `${clock(s.start)} ${half(s.start)}`;
  return `${DAY_SHORT[s.dow] ?? "?"} ${start}–${clock(s.end)} ${half(s.end)}`;
}

export const sameSlots = (a: Slot[], b: Slot[]) =>
  a.length === b.length && a.every((s, i) => s.dow === b[i].dow && s.start === b[i].start && s.end === b[i].end);

export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start));
}

/* ------------------------------------------------------------------------- */
/* Seasons                                                                    */
/* ------------------------------------------------------------------------- */

const TERMS = ["Spring", "Summer", "Fall"] as const;

/** The term a date falls in: Jan–May Spring, Jun–Jul Summer, Aug–Dec Fall. */
export function seasonNameFor(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${m <= 5 ? "Spring" : m <= 7 ? "Summer" : "Fall"} ${y}`;
}

/** "Fall 2026" → "Spring 2027"; "Spring 2027" → "Summer 2027"; anything else → null. */
export function nextSeasonName(name: string): string | null {
  const m = /^\s*(Winter|Spring|Summer|Fall|Autumn)\s+(\d{4})\s*$/i.exec(name);
  if (!m) return null;
  const term = m[1].toLowerCase();
  const year = Number(m[2]);
  if (term === "winter") return `Spring ${year}`;
  if (term === "fall" || term === "autumn") return `Spring ${year + 1}`;
  const i = TERMS.findIndex((t) => t.toLowerCase() === term);
  return `${TERMS[i + 1]} ${year}`;
}

/**
 * The season a new session most likely belongs to: the one her latest session
 * went into (if it's still open), else the current or next open season.
 */
export function defaultSeasonId(ctx: Pick<FlowContext, "seasons" | "sessions">): string | null {
  const open = ctx.seasons.filter((s) => s.status !== "closed");
  const latest = [...ctx.sessions]
    .filter((s) => s.season_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (latest && open.some((s) => s.id === latest.season_id)) return latest.season_id;
  return (open.find((s) => s.status === "active") ?? open[0])?.id ?? null;
}

/* ------------------------------------------------------------------------- */
/* Building a draft                                                           */
/* ------------------------------------------------------------------------- */

export function emptyDraft(ctx: FlowContext): Draft {
  const seasonId = defaultSeasonId(ctx);
  return {
    program: { mode: "new", name: "", sport: "basketball", ages: [], description: "", fee: "", capacity: "12" },
    season: seasonId ? { mode: "existing", id: seasonId } : { mode: "new", name: seasonNameFor(ctx.today), start: "", end: "" },
    startDate: "",
    endDate: "",
    slots: [],
    location: "",
    schools: [],
    registrationOpen: true,
    website: { show: true, title: "", description: "", mediaId: null, featured: false },
    youthCamp: { confirmed: false, number: "" },
  };
}

export function pickFor(school: { id: string | null; name: string; address?: string | null }): SchoolPick {
  return {
    key: school.id ?? `new:${school.name.trim().toLowerCase()}`,
    id: school.id,
    name: school.name.trim(),
    address: school.address ?? "",
    fee: "",
    capacity: "",
    coachId: "",
    location: "",
    slots: null,
  };
}

/**
 * Add a school. Its usual weekly time becomes the shared schedule when there
 * isn't one yet; when there is and this school's usual time differs, the
 * school keeps its own (shown in the per-school table, one tap to undo).
 */
export function addSchool(d: Draft, school: SchoolOption | { id: null; name: string; address: string }): Draft {
  const pick = pickFor(school);
  if (d.schools.some((s) => s.key === pick.key || s.name.toLowerCase() === pick.name.toLowerCase())) return d;
  const usual = "usualSlots" in school ? sortSlots(school.usualSlots) : [];
  let slots = d.slots;
  if (usual.length && slots.length === 0) slots = usual;
  else if (usual.length && !sameSlots(usual, sortSlots(slots))) pick.slots = usual;
  return { ...d, slots, schools: [...d.schools, pick] };
}

export function removeSchool(d: Draft, key: string): Draft {
  return { ...d, schools: d.schools.filter((s) => s.key !== key) };
}

export function updateSchool(d: Draft, key: string, patch: Partial<SchoolPick>): Draft {
  return { ...d, schools: d.schools.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

/** Filter schools for the multi-select: by name or address, chosen ones excluded. */
export function searchSchools(schools: SchoolOption[], query: string, chosen: SchoolPick[]): SchoolOption[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(chosen.map((c) => c.id));
  return schools
    .filter((s) => !taken.has(s.id))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.address ?? "").toLowerCase().includes(q));
}

/** A draft that puts an existing program on at more schools ("Add to another school"). */
export function draftForProgram(ctx: FlowContext, catalogId: string): Draft {
  const d = emptyDraft(ctx);
  const own = ctx.sessions.filter((s) => s.catalog_id === catalogId);
  // Same weekly times as its latest session, as a starting point.
  const latest = [...own].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  // And the photo its cards use, when it's still in the library.
  const photo = own
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((s) => s.media_id)
    .find((m) => m && ctx.photos.some((p) => p.id === m));
  return {
    ...d,
    program: { mode: "existing", id: catalogId },
    slots: latest ? sortSlots(latest.slots) : [],
    website: { ...d.website, mediaId: photo ?? null },
  };
}

/**
 * "Duplicate for next season": the same schools, fees, places, coaches and
 * times as the program's sessions in `fromSeasonId`, in the season after it.
 * Registration starts open; the website card is on, as before.
 */
export function draftForNextSeason(ctx: FlowContext, catalogId: string, fromSeasonId: string): Draft {
  const d = draftForProgram(ctx, catalogId);
  const from = ctx.seasons.find((s) => s.id === fromSeasonId);
  const source = ctx.sessions.filter((s) => s.catalog_id === catalogId && s.season_id === fromSeasonId);
  const nextName = from ? nextSeasonName(from.name) : null;
  const existingNext =
    (nextName && ctx.seasons.find((s) => s.name.toLowerCase() === nextName.toLowerCase() && s.status !== "closed")) ||
    ctx.seasons
      .filter((s) => s.status !== "closed" && s.id !== fromSeasonId && (!from?.start_date || (s.start_date ?? "") > from.start_date))
      .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"))[0];
  const season: SeasonChoice = existingNext
    ? { mode: "existing", id: existingNext.id }
    : { mode: "new", name: nextName ?? "", start: "", end: "" };

  const shared = source.length ? sortSlots(source[0].slots) : d.slots;
  const schools: SchoolPick[] = [];
  for (const s of source) {
    const school = ctx.schools.find((x) => x.id === s.school_id);
    if (!school || schools.some((x) => x.id === school.id)) continue;
    const p = pickFor(school);
    const slots = sortSlots(s.slots);
    schools.push({
      ...p,
      fee: String(s.monthly_fee),
      capacity: String(s.capacity),
      coachId: s.coach_id ?? "",
      location: s.location ?? "",
      slots: sameSlots(slots, shared) ? null : slots,
    });
  }
  return { ...d, season, slots: shared, schools };
}

/* ------------------------------------------------------------------------- */
/* What the program is, whichever way it was chosen                            */
/* ------------------------------------------------------------------------- */

export function programFacts(d: Draft, ctx: Pick<FlowContext, "catalog">) {
  if (d.program.mode === "existing") {
    const id = d.program.id;
    const c = ctx.catalog.find((x) => x.id === id);
    return {
      name: c?.name ?? "",
      sport: c?.sport ?? "",
      ages: c?.age_groups ?? [],
      description: c?.description ?? "",
      fee: c?.default_monthly_fee ?? 0,
      capacity: c?.default_capacity ?? 12,
    };
  }
  const p = d.program;
  return {
    name: p.name.trim(),
    sport: p.sport.trim().toLowerCase(),
    ages: p.ages,
    description: p.description.trim(),
    fee: parseMoney(p.fee) ?? 0,
    capacity: parseCount(p.capacity) ?? 12,
  };
}

export function seasonFacts(d: Draft, ctx: Pick<FlowContext, "seasons">) {
  if (d.season.mode === "existing") {
    const id = d.season.id;
    const s = ctx.seasons.find((x) => x.id === id);
    return { name: s?.name ?? null, start: s?.start_date ?? null, end: s?.end_date ?? null };
  }
  if (d.season.mode === "new") return { name: d.season.name.trim() || null, start: d.season.start || null, end: d.season.end || null };
  return { name: null, start: null, end: null };
}

/** The dates the sessions will run: typed, else the season's. */
export function effectiveDates(d: Draft, ctx: Pick<FlowContext, "seasons">) {
  const s = seasonFacts(d, ctx);
  return { start: d.startDate || s.start, end: d.endDate || s.end };
}

/** Each chosen school's session as it will be saved. */
export function resolvedSessions(d: Draft, ctx: Pick<FlowContext, "catalog">) {
  const p = programFacts(d, ctx);
  return d.schools.map((s) => ({
    key: s.key,
    name: s.name,
    isNew: !s.id,
    fee: parseMoney(s.fee) ?? p.fee,
    capacity: parseCount(s.capacity) ?? p.capacity,
    coachId: s.coachId || null,
    location: s.location.trim() || d.location.trim() || null,
    slots: sortSlots(s.slots ?? d.slots),
    ownSlots: s.slots !== null,
  }));
}

/* ------------------------------------------------------------------------- */
/* Youth camps (Tex. Health & Safety Code ch. 141)                             */
/* ------------------------------------------------------------------------- */

/** The sessions whose weekly times, within their dates, meet 4+ days in a row. */
export function campSessions(d: Draft, ctx: Pick<FlowContext, "catalog" | "seasons">): { name: string; check: YouthCampCheck }[] {
  const { start, end } = effectiveDates(d, ctx);
  const out: { name: string; check: YouthCampCheck }[] = [];
  const shared = youthCampCheck({ days: d.slots.map((s) => s.dow), start, end });
  for (const s of resolvedSessions(d, ctx)) {
    const check = s.ownSlots ? youthCampCheck({ days: s.slots.map((x) => x.dow), start, end }) : shared;
    if (check.looksLikeCamp) out.push({ name: s.name, check });
  }
  // Before any school is picked, the shared schedule alone.
  if (d.schools.length === 0 && shared.looksLikeCamp) out.push({ name: "", check: shared });
  return out;
}

/** On the website: a card, or (with no card) open for sign-ups — as site_offerings decides. */
export const goesOnWebsite = (d: Draft) => d.website.show || d.registrationOpen;

export function licenseConfirmed(d: Draft): boolean {
  return !!d.youthCamp?.confirmed && validLicenseNumber(d.youthCamp.number);
}

/* ------------------------------------------------------------------------- */
/* Checks                                                                     */
/* ------------------------------------------------------------------------- */

export type Step = "program" | "where" | "website";
export const STEPS: { id: Step; label: string }[] = [
  { id: "program", label: "Program" },
  { id: "where", label: "Schools & times" },
  { id: "website", label: "Sign-ups & website" },
];

function slotProblems(slots: Slot[], where: string): string[] {
  const out: string[] = [];
  for (const s of slots) {
    if (!(s.dow >= 0 && s.dow <= 6)) out.push(`Pick a day for each practice${where}.`);
    else if (!isTime(s.start) || !isTime(s.end)) out.push(`Give each practice${where} a start and end time.`);
    else if (s.end <= s.start) out.push(`A practice${where} ends before it starts (${slotText(s)}).`);
  }
  return out;
}

/** What's wrong with a step, in plain words. Empty when it's fine. */
export function stepProblems(d: Draft, ctx: FlowContext, step: Step): string[] {
  const out: string[] = [];
  if (step === "program") {
    if (d.program.mode === "existing") {
      const id = d.program.id;
      const c = ctx.catalog.find((x) => x.id === id);
      if (!c) out.push("Pick a program, or make a new one.");
      else if (c.status === "archived") out.push(`${c.name} is archived. Bring it back on the Programs page first.`);
    } else {
      const p = d.program;
      const name = p.name.trim();
      if (!name) out.push("Give the program a name.");
      else if (ctx.catalog.some((c) => c.name.trim().toLowerCase() === name.toLowerCase()))
        out.push(`There's already a program called "${name}". Pick it from the list instead.`);
      const fee = parseMoney(p.fee);
      if (fee !== null && (Number.isNaN(fee) || fee < 0)) out.push("The usual monthly fee should be an amount, like 120 — or 0 if it's free.");
      const cap = parseCount(p.capacity);
      if (cap !== null && (Number.isNaN(cap) || cap <= 0)) out.push("How many children can join? Enter a number above 0.");
    }
  }
  if (step === "where") {
    if (d.schools.length === 0) out.push("Pick at least one school.");
    for (const s of d.schools) if (!s.name.trim()) out.push("Give the new school a name.");
    if (d.season.mode === "existing") {
      const id = d.season.id;
      const s = ctx.seasons.find((x) => x.id === id);
      if (!s) out.push("Pick a season.");
      else if (s.status === "closed") out.push(`${s.name} is closed. Pick a current or upcoming season.`);
    }
    if (d.season.mode === "new") {
      if (!d.season.name.trim()) out.push("Name the new season, like Fall 2026.");
      if (d.season.start && d.season.end && d.season.end < d.season.start) out.push("The season ends before it starts.");
    }
    for (const v of [d.startDate, d.endDate]) if (v && !isDate(v)) out.push("Check the dates.");
    const { start, end } = effectiveDates(d, ctx);
    if (start && end && end < start) out.push("The end date is before the start date.");
    out.push(...slotProblems(d.slots, ""));
    for (const s of d.schools) {
      const fee = parseMoney(s.fee);
      if (fee !== null && (Number.isNaN(fee) || fee < 0)) out.push(`The fee at ${s.name} should be an amount, like 120.`);
      const cap = parseCount(s.capacity);
      if (cap !== null && (Number.isNaN(cap) || cap <= 0)) out.push(`Places at ${s.name} should be a number above 0.`);
      if (s.slots) out.push(...slotProblems(s.slots, ` at ${s.name}`));
      if (s.coachId && !ctx.coaches.some((c) => c.id === s.coachId)) out.push(`The coach picked for ${s.name} is no longer there.`);
    }
  }
  if (step === "website" && goesOnWebsite(d) && !licenseConfirmed(d) && campSessions(d, ctx).length > 0) {
    out.push(
      d.youthCamp?.confirmed
        ? "Enter the DSHS youth camp license number."
        : `${YOUTH_CAMP_BLOCKED} Or turn off "Show on the website" and "Open for sign-ups now".`
    );
  }
  if (step === "website" && d.website.show && d.website.mediaId) {
    const id = d.website.mediaId;
    if (!ctx.photos.some((p) => p.id === id)) out.push("That photo is no longer in the library. Pick another.");
  }
  return [...new Set(out)];
}

export function problems(d: Draft, ctx: FlowContext): string[] {
  return STEPS.flatMap((s) => stepProblems(d, ctx, s.id));
}

/** Notes worth seeing before saving, which don't stop it. */
export function warnings(d: Draft, ctx: FlowContext): string[] {
  const out: string[] = [];
  if (d.slots.length === 0 && d.schools.some((s) => !s.slots?.length)) out.push("No weekly practice time yet — practices can't be added to the schedule until there is one.");
  const { start, end } = effectiveDates(d, ctx);
  if (!start || !end) out.push("No start or end date yet — the website card won't show dates.");
  if (d.program.mode === "existing") {
    const id = d.program.id;
    const seasonId = d.season.mode === "existing" ? d.season.id : null;
    for (const s of d.schools) {
      if (s.id && ctx.sessions.some((x) => x.catalog_id === id && x.school_id === s.id && x.season_id === seasonId)) {
        out.push(`It's already on at ${s.name} this season — this adds a second session there.`);
      }
    }
  }
  if (d.website.show && d.website.mediaId) {
    const id = d.website.mediaId;
    const photo = ctx.photos.find((p) => p.id === id);
    if (photo && !photo.live) out.push("That photo isn't published yet, so the card uses the sport's photo until it is.");
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* The one save                                                               */
/* ------------------------------------------------------------------------- */

export interface Payload {
  program: { id: string } | { name: string; sport: string; age_groups: string[]; description: string; default_monthly_fee: number | null; default_capacity: number | null };
  season: { id: string } | { name: string; start_date: string | null; end_date: string | null } | null;
  start_date: string | null;
  end_date: string | null;
  slots: Slot[];
  location: string | null;
  registration_open: boolean;
  sessions: {
    school: { id: string } | { name: string; address: string | null };
    monthly_fee: number | null;
    capacity: number | null;
    coach_id: string | null;
    location: string | null;
    slots: Slot[] | null;
  }[];
  website: { show: boolean; title: string | null; description: string | null; media_id: string | null; featured: boolean };
  /** Sent only when confirmed and needed; stored on every session. */
  youth_camp_license?: { number: string; confirmed_by?: string | null };
}

const orNull = (n: number | null) => (n === null || Number.isNaN(n) ? null : n);

/** The jsonb ops.create_program_sessions takes. Assumes problems() is empty. */
export function toPayload(d: Draft): Payload {
  const p = d.program;
  return {
    program:
      p.mode === "existing"
        ? { id: p.id }
        : {
            name: p.name.trim(),
            sport: p.sport.trim().toLowerCase() || "basketball",
            age_groups: p.ages,
            description: p.description.trim(),
            default_monthly_fee: orNull(parseMoney(p.fee)),
            default_capacity: orNull(parseCount(p.capacity)),
          },
    season:
      d.season.mode === "existing"
        ? { id: d.season.id }
        : d.season.mode === "new"
          ? { name: d.season.name.trim(), start_date: d.season.start || null, end_date: d.season.end || null }
          : null,
    start_date: d.startDate || null,
    end_date: d.endDate || null,
    slots: sortSlots(d.slots),
    location: d.location.trim() || null,
    registration_open: d.registrationOpen,
    sessions: d.schools.map((s) => ({
      school: s.id ? { id: s.id } : { name: s.name.trim(), address: s.address.trim() || null },
      monthly_fee: orNull(parseMoney(s.fee)),
      capacity: orNull(parseCount(s.capacity)),
      coach_id: s.coachId || null,
      location: s.location.trim() || null,
      slots: s.slots ? sortSlots(s.slots) : null,
    })),
    website: {
      show: d.website.show,
      title: d.website.title.trim() || null,
      description: d.website.description.trim() || null,
      media_id: d.website.show ? d.website.mediaId : null,
      featured: d.website.featured,
    },
    ...(licenseConfirmed(d) ? { youth_camp_license: { number: d.youthCamp!.number.trim() } } : {}),
  };
}

/* ------------------------------------------------------------------------- */
/* The website card, as parents will see it                                   */
/* ------------------------------------------------------------------------- */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dateText(start: string | null, end: string | null) {
  const f = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return { y, m, day };
  };
  if (!start && !end) return "";
  if (start && !end) return `Starts ${MONTHS[f(start).m - 1]} ${f(start).day}, ${f(start).y}`;
  if (!start && end) return `Until ${MONTHS[f(end).m - 1]} ${f(end).day}, ${f(end).y}`;
  const s = f(start!);
  const e = f(end!);
  return s.y === e.y
    ? `${MONTHS[s.m - 1]} ${s.day} – ${MONTHS[e.m - 1]} ${e.day}, ${e.y}`
    : `${MONTHS[s.m - 1]} ${s.day}, ${s.y} – ${MONTHS[e.m - 1]} ${e.day}, ${e.y}`;
}

const price = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}/month`;

export interface CardPreview {
  title: string;
  description: string;
  ages: string[];
  dates: string;
  photo: PhotoOption | null;
  sport: string;
  registrationOpen: boolean;
  places: { school: string; times: string; price: string; spots: string }[];
}

export function cardPreview(d: Draft, ctx: FlowContext): CardPreview {
  const p = programFacts(d, ctx);
  const { start, end } = effectiveDates(d, ctx);
  return {
    title: d.website.title.trim() || p.name || "Your program",
    description: d.website.description.trim() || p.description,
    ages: p.ages,
    dates: dateText(start, end),
    photo: (d.website.mediaId && ctx.photos.find((x) => x.id === d.website.mediaId)) || null,
    sport: p.sport,
    registrationOpen: d.registrationOpen,
    places: resolvedSessions(d, ctx).map((s) => ({
      school: s.name,
      times: s.slots.map(slotText).join(", ") || "Times to be announced",
      price: price(s.fee),
      spots: `${s.capacity} spots`,
    })),
  };
}
