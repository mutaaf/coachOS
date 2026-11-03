import { addDays, dayOfWeek } from "@/lib/dates";

/**
 * Is this schedule a youth camp under Texas law?
 *
 * Tex. Health & Safety Code ch. 141 makes a program a "youth camp" — which
 * must hold a license from the Department of State Health Services — when it
 * has five or more minors in its care for four or more consecutive days.
 * Rising Stars holds no such license (owner, 2026-10-05). Practices once or
 * twice a week never come close; a "camp week" (Mon–Fri) or a Mon–Thu
 * schedule does.
 *
 * These are plain functions, shared by the New program flow, the schedule
 * template editor and their tests. The database applies the same rule before
 * a session can go on the website (ops.program_meeting_run,
 * 20261007000200_youth_camp_guard.sql).
 */

export const YOUTH_CAMP_MIN_DAYS = 4;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_SPAN_DAYS = 400;
// A Sunday, for walking a weekly pattern that has no dates of its own.
const ANCHOR_SUNDAY = "2026-01-04";

export interface MeetingPattern {
  /** Weekly days it meets, 0 = Sunday. */
  days: number[];
  /** The session's first and last dates (YYYY-MM-DD), if known. */
  start?: string | null;
  end?: string | null;
  /** Individual dates it meets on (practices, make-ups), YYYY-MM-DD. */
  dates?: string[];
}

export interface Run {
  length: number;
  first: string;
  last: string;
}

const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** The longest stretch of consecutive calendar days with a meeting. */
export function longestMeetingRun(p: MeetingPattern): Run | null {
  const weekly = new Set(p.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const extra = new Set((p.dates ?? []).filter(isDate));

  // The days to walk: the session's own dates when it has both (capped), else
  // two weeks of the weekly pattern, which shows any run that wraps past
  // Saturday — plus a week either side of each individual date.
  const windows: [string, string][] = [];
  if (weekly.size) {
    if (isDate(p.start) && isDate(p.end) && p.end >= p.start) {
      const capped = addDays(p.start, MAX_SPAN_DAYS);
      windows.push([p.start, p.end < capped ? p.end : capped]);
    } else {
      windows.push([ANCHOR_SUNDAY, addDays(ANCHOR_SUNDAY, 13)]);
    }
  }
  for (const d of extra) windows.push([addDays(d, -7), addDays(d, 7)]);

  const bounded = isDate(p.start) && isDate(p.end);
  const meets = (d: string) =>
    extra.has(d) || (weekly.has(dayOfWeek(d)) && (!bounded || (d >= p.start! && d <= p.end!)));

  let best: Run | null = null;
  for (const [from, to] of windows) {
    let runStart: string | null = null;
    let len = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (meets(d)) {
        if (!runStart) runStart = d;
        len++;
        if (!best || len > best.length) best = { length: len, first: runStart, last: d };
      } else {
        runStart = null;
        len = 0;
      }
    }
  }
  // Every day of the week, with no end date: it never stops.
  if (best && weekly.size === 7 && !bounded) best = { ...best, length: Math.max(best.length, 7) };
  return best;
}

export interface YouthCampCheck {
  /** Meets on 4 or more consecutive days. */
  looksLikeCamp: boolean;
  longest: number;
  /** "Mon–Thu", "Jun 8–Jun 12" — the stretch, for the warning. */
  stretch: string | null;
}

export function youthCampCheck(p: MeetingPattern): YouthCampCheck {
  const run = longestMeetingRun(p);
  if (!run) return { looksLikeCamp: false, longest: 0, stretch: null };
  const dated = (isDate(p.start) && isDate(p.end)) || (!p.days.length && (p.dates ?? []).length > 0);
  const label = (d: string) =>
    dated
      ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : DAY_SHORT[dayOfWeek(d)];
  const stretch = run.length >= 7 && !dated ? "every day" : `${label(run.first)}–${label(run.last)}`;
  return { looksLikeCamp: run.length >= YOUTH_CAMP_MIN_DAYS, longest: run.length, stretch };
}

/** A license number as she'd type it: something, not blank. */
export function validLicenseNumber(n: string | null | undefined): boolean {
  return typeof n === "string" && n.trim().length >= 3 && n.trim().length <= 60;
}

/** The warning, in plain words, shown wherever such a schedule is made. */
export function youthCampWarning(stretch: string | null): string {
  return (
    `This meets ${stretch ?? "4 or more days"} in a row. Under Texas law (Health & Safety Code ch. 141) a program ` +
    `caring for 5 or more children for 4 or more consecutive days is a youth camp and needs a DSHS youth camp ` +
    `license. Rising Stars doesn't hold one, so it can't go on the website or open for sign-ups unless you confirm ` +
    `a current license and enter its number.`
  );
}

export const YOUTH_CAMP_BLOCKED =
  "This session meets 4 or more days in a row — a youth camp under Texas law. It can't be on the website or open for sign-ups until you confirm a current DSHS youth camp license and enter its number.";
