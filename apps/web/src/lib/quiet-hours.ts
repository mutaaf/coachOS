import { BUSINESS_TIMEZONE } from "@/lib/dates";

/**
 * Texas quiet hours for promotional texts (Tex. Bus. & Com. Code §301.051):
 * no telephone solicitation before 9 a.m. or after 9 p.m. Monday to Saturday,
 * or before noon or after 9 p.m. on Sunday — on the clock where the family
 * is, which for Rising Stars is always Dallas–Fort Worth (America/Chicago).
 *
 * Only promotions are affected. A practice reminder or a payment link is not a
 * solicitation and can go at any hour.
 *
 * Both ends are inclusive: 9:00:00 p.m. is still "not after 9 p.m.". The
 * database applies the same rule when a promotion is marked sent
 * (ops.promotional_text_allowed, 20261007000100_promotional_texts.sql).
 */

export const PROMO_HOURS_TEXT = "Monday–Saturday 9 a.m.–9 p.m. and Sunday noon–9 p.m. (Texas time)";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Day of week (0 = Sunday) and seconds since midnight, on Dallas's clock. */
function texasClock(now: Date): { dow: number; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const seconds = Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second"));
  // Sub-second precision matters only at 9:00:00 p.m. exactly: 21:00:00.500 is after 9.
  const extra = now.getUTCMilliseconds() > 0 ? 0.5 : 0;
  return { dow, seconds: seconds + extra };
}

const opensAt = (dow: number) => (dow === 0 ? 12 : 9) * 3600;
const CLOSES_AT = 21 * 3600;

/** May a promotional text be sent at this moment? */
export function promotionalTextAllowed(now: Date = new Date()): boolean {
  const { dow, seconds } = texasClock(now);
  return seconds >= opensAt(dow) && seconds <= CLOSES_AT;
}

/** "9 a.m. Monday", "noon Sunday", "9 a.m. today" — when promotions may go again. */
export function nextPromotionalWindow(now: Date = new Date()): string {
  const { dow, seconds } = texasClock(now);
  if (seconds < opensAt(dow)) return `${dow === 0 ? "noon" : "9 a.m."} today`;
  // After 9 p.m.: the next window is tomorrow's.
  const next = (dow + 1) % 7;
  return `${next === 0 ? "noon" : "9 a.m."} tomorrow (${DAYS[next]})`;
}

/**
 * Why a promotion can't go right now, in her words — or null when it can.
 */
export function quietHoursMessage(now: Date = new Date()): string | null {
  if (promotionalTextAllowed(now)) return null;
  return (
    `Texas law doesn't allow promotional texts right now. They can go ${PROMO_HOURS_TEXT}. ` +
    `Try again after ${nextPromotionalWindow(now)}. Practice and payment messages aren't affected.`
  );
}
