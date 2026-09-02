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
