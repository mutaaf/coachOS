/**
 * Dates, in the timezone the business actually operates in.
 *
 * `new Date().toISOString().split("T")[0]` is the obvious way to get today and
 * it is wrong here. It converts to UTC first, so from 7pm in Dallas it already
 * reports tomorrow — which marked invoices overdue the evening before they were
 * late and had the reminder cron tell parents they had missed a payment they
 * hadn't. On Vercel the server runs in UTC, so it never agrees with the people
 * using it unless the timezone is stated.
 */

export const BUSINESS_TIMEZONE = "America/Chicago";

/** Today's calendar date where the sessions happen, as YYYY-MM-DD. */
export function businessToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is also how dates are stored.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The current month as YYYY-MM, for invoice runs. */
export function businessMonth(now: Date = new Date()): string {
  return businessToday(now).slice(0, 7);
}

/**
 * True only once the due date has passed. An invoice due today is due, not
 * late — comparing a date string to a timestamp made everything due today
 * overdue from midnight.
 */
export function isPastDue(dueDate: string, now: Date = new Date()): boolean {
  return dueDate < businessToday(now);
}

/** N days before today, as YYYY-MM-DD. */
export function businessDaysAgo(days: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - days * 86_400_000);
  return businessToday(shifted);
}

/**
 * Format a Date as YYYY-MM-DD from its own parts.
 *
 * Going through toISOString() shifts the date whenever the runtime's offset
 * pushes it across midnight, which is how a Tuesday session ends up stored as
 * Monday.
 */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/**
 * Read a stored YYYY-MM-DD as that calendar day, at local midnight.
 *
 * `new Date("2026-10-06")` is midnight UTC, which anywhere west of London is
 * still the evening before — so a Tuesday practice showed as Monday, and a
 * follow-up due today showed as overdue.
 */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d);
}

/**
 * Show a stored YYYY-MM-DD for people to read, as the same day on every
 * machine. It is formatted in UTC from its own parts, so neither the server's
 * clock nor the browser's timezone can move it.
 */
export function formatDateOnly(
  iso: string,
  options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", year: "numeric" }
): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** A YYYY-MM-DD moved by whole days, as YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(moved.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(moved.getUTCDate()).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${mm}-${dd}`;
}

/** A day of the month as people say it: 1st, 2nd, 3rd, 11th, 22nd. */
export function dayOfMonthLabel(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] || "th";
  return `${day}${suffix}`;
}

/** Day of the week for a YYYY-MM-DD, 0 = Sunday. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Tomorrow's calendar date where the sessions happen, as YYYY-MM-DD. */
export function businessTomorrow(now: Date = new Date()): string {
  return addDays(businessToday(now), 1);
}

/** The hour, 0-23, on the clock where the sessions happen. */
export function businessHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  );
}

/**
 * Sunday to Saturday of the business's week, moved by `offset` weeks, as
 * YYYY-MM-DD. The Schedule grid built this from the UTC date, so after 7pm in
 * Dallas every practice slid one column to the left.
 */
export function businessWeek(offset = 0, now: Date = new Date()): string[] {
  const today = businessToday(now);
  const sunday = addDays(today, offset * 7 - dayOfWeek(today));
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

/**
 * The moment a stored day and time happen where the sessions are, e.g. a
 * practice ending at "17:00" on "2026-10-06" in Dallas. The server runs in UTC,
 * so reading the time as its own would put every practice five or six hours
 * early.
 */
export function businessInstant(iso: string, time: string): Date {
  const [y, m, d] = parts(iso);
  const [h, min] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  // Guess with the offset at that wall time, then correct once for a DST change.
  let instant = asUtc - offsetAt(new Date(asUtc));
  instant = asUtc - offsetAt(new Date(instant));
  return new Date(instant);
}

/** How far the business's clock is ahead of UTC at a moment, in ms (negative in Dallas). */
function offsetAt(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)])
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** A moment as she reads it on the business's clock, e.g. "Tue, Oct 6, 11:00 PM". */
export function formatBusinessTime(at: Date | string): string {
  return new Date(at).toLocaleString("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Good morning" and so on, by the business's clock rather than the server's. */
export function greeting(now: Date = new Date()): string {
  const hour = businessHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Today", "Tomorrow", or the day itself, e.g. "Tue, Oct 6". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  if (iso === businessToday(now)) return "Today";
  if (iso === businessTomorrow(now)) return "Tomorrow";
  return formatDateOnly(iso, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * A practice's day as a message names it: "today's practice", "tomorrow's
 * practice", or "the practice on Tuesday, October 6".
 */
export function sessionDayPhrase(iso: string, now: Date = new Date()): string {
  if (iso === businessToday(now)) return "today's practice";
  if (iso === businessTomorrow(now)) return "tomorrow's practice";
  return `the practice on ${formatDateOnly(iso, { weekday: "long", month: "long", day: "numeric" })}`;
}
