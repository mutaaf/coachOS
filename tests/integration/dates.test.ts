import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  businessToday,
  businessMonth,
  businessDaysAgo,
  businessTomorrow,
  businessHour,
  businessWeek,
  isPastDue,
  toISODate,
  parseDateOnly,
  formatDateOnly,
  addDays,
  dayOfWeek,
  dayLabel,
  greeting,
  sessionDayPhrase,
  businessInstant,
  formatBusinessTime,
} from "@/lib/dates";

/**
 * These exist because of a bug that only appeared after 7pm.
 *
 * `new Date().toISOString()` converts to UTC first, so from 19:00 in Dallas it
 * already reports tomorrow. Invoices due today were marked overdue that
 * evening, and the reminder cron would have told parents they had missed a
 * payment that was not yet late. The run-book test caught it by running at 18:56
 * and passing, then at 19:01 and failing.
 */

describe("dates in the timezone the business runs in", () => {
  // 2026-09-02T00:30:00Z is still 2026-09-01, 7:30pm, in Dallas.
  const lateEvening = new Date("2026-09-02T00:30:00Z");

  it("still calls it today at half past seven in the evening", () => {
    expect(businessToday(lateEvening)).toBe("2026-09-01");
    // The naive version is what went wrong.
    expect(lateEvening.toISOString().split("T")[0]).toBe("2026-09-02");
  });

  it("does not treat an invoice due today as overdue that evening", () => {
    expect(isPastDue("2026-09-01", lateEvening)).toBe(false);
  });

  it("does treat yesterday's invoice as overdue", () => {
    expect(isPastDue("2026-08-31", lateEvening)).toBe(true);
  });

  it("keeps the month right across the same boundary", () => {
    // 2026-10-01T02:00Z is still September 30th in Dallas — an invoice run that
    // evening belongs to September, not October.
    const monthEnd = new Date("2026-10-01T02:00:00Z");
    expect(businessMonth(monthEnd)).toBe("2026-09");
  });

  it("counts back the right number of days", () => {
    expect(businessDaysAgo(3, lateEvening)).toBe("2026-08-29");
  });

  it("formats a date from its own parts, without shifting it", () => {
    // Late-evening local time: toISOString would report the next day.
    const d = new Date(2026, 8, 1, 23, 30);
    expect(toISODate(d)).toBe("2026-09-01");
  });

  it("agrees with itself for a normal midday moment", () => {
    const midday = new Date("2026-09-01T17:00:00Z"); // noon in Dallas
    expect(businessToday(midday)).toBe("2026-09-01");
    expect(isPastDue("2026-09-01", midday)).toBe(false);
    expect(isPastDue("2026-09-02", midday)).toBe(false);
  });
});

/**
 * Stored days ("2026-10-06") are calendar days, not moments. Reading them with
 * `new Date("2026-10-06")` lands on midnight in London — the evening before in
 * Dallas — which showed Tuesday practices as Monday, program dates a day early,
 * and today's lead follow-ups as overdue. And the dashboard and the Schedule
 * grid took the hour and the week from whichever clock they ran on: the
 * server's is UTC.
 */
describe("stored days and the business's clock", () => {
  // Tuesday 2026-10-06, 7:30pm in Dallas; UTC has already reached Wednesday.
  const tuesdayEvening = new Date("2026-10-07T00:30:00Z");
  // Tuesday 2026-10-06, 9am in Dallas.
  const tuesdayMorning = new Date("2026-10-06T14:00:00Z");

  it("reads a stored day as that day, wherever the machine is", () => {
    const d = parseDateOnly("2026-10-06");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()]).toEqual([2026, 9, 6, 2]);
    expect(toISODate(d)).toBe("2026-10-06");
  });

  it("shows a Tuesday practice as Tuesday", () => {
    expect(formatDateOnly("2026-10-06", { weekday: "long", month: "long", day: "numeric" })).toBe(
      "Tuesday, October 6"
    );
    expect(formatDateOnly("2026-09-01")).toBe("9/1/2026");
    expect(dayOfWeek("2026-10-06")).toBe(2);
  });

  it("counts days across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    // Across the clocks going back, which a 24-hour step would trip on.
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("keeps tomorrow tomorrow at half past seven", () => {
    expect(businessTomorrow(tuesdayEvening)).toBe("2026-10-07");
  });

  it("builds the Schedule week from Dallas's date, not UTC's", () => {
    expect(businessWeek(0, tuesdayEvening)).toEqual([
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
    expect(businessWeek(1, tuesdayEvening)[0]).toBe("2026-10-11");
    expect(businessWeek(-1, tuesdayEvening)[6]).toBe("2026-10-03");
  });

  it("says good evening in Dallas when the server's clock says midnight", () => {
    expect(businessHour(tuesdayEvening)).toBe(19);
    expect(greeting(tuesdayEvening)).toBe("Good evening");
    expect(greeting(tuesdayMorning)).toBe("Good morning");
  });

  it("labels today's and tomorrow's sessions by Dallas's date", () => {
    expect(dayLabel("2026-10-06", tuesdayEvening)).toBe("Today");
    expect(dayLabel("2026-10-07", tuesdayEvening)).toBe("Tomorrow");
    expect(dayLabel("2026-10-09", tuesdayEvening)).toBe("Fri, Oct 9");
  });

  it("does not call tomorrow's practice today's in the coach's message", () => {
    expect(sessionDayPhrase("2026-10-06", tuesdayMorning)).toBe("today's practice");
    expect(sessionDayPhrase("2026-10-07", tuesdayMorning)).toBe("tomorrow's practice");
    expect(sessionDayPhrase("2026-10-09", tuesdayMorning)).toBe("the practice on Friday, October 9");
  });

  it("puts a practice's time on Dallas's clock, either side of the clocks changing", () => {
    // Daylight time: Dallas is UTC-5.
    expect(businessInstant("2026-10-06", "17:00").toISOString()).toBe("2026-10-06T22:00:00.000Z");
    // Standard time: UTC-6.
    expect(businessInstant("2026-12-01", "09:00").toISOString()).toBe("2026-12-01T15:00:00.000Z");
    expect(businessInstant("2026-11-01", "10:00:00").toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(businessInstant("2027-03-14", "16:00").toISOString()).toBe("2027-03-14T21:00:00.000Z");
  });

  it("shows a moment on Dallas's clock", () => {
    expect(formatBusinessTime("2026-10-07T04:00:00.000Z")).toBe("Tue, Oct 6, 11:00 PM");
  });
});

/**
 * The same mistake kept coming back in new places, so the source is checked
 * for it. Timestamps (created_at and the like) are moments and may use Date
 * freely; it is stored days and "today" that must go through lib/dates.ts.
 */
describe("no date is read or written the UTC way", () => {
  const root = join(__dirname, "../../apps/web/src");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  const RULES: [RegExp, string][] = [
    [
      /toISOString\(\)\s*\.\s*(split\(\s*["']T["']\s*\)|slice\(\s*0\s*,\s*10\s*\))/,
      "today from toISOString() — use businessToday()",
    ],
    [
      /new Date\(\s*[\w.?!]*(date|Date|_follow_up|dateStr)\s*\)/,
      "a stored day read as a moment — use parseDateOnly() or formatDateOnly()",
    ],
    [/new Date\(\)\.getHours\(\)/, "the server's hour — use businessHour()"],
  ];

  it("lib/dates.ts is the only way in", () => {
    const offences: string[] = [];
    for (const file of files(root)) {
      if (file.endsWith("lib/dates.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const [pattern, why] of RULES) {
        // Whole-file, so a call broken across lines is still caught.
        for (const match of source.matchAll(new RegExp(pattern, "g"))) {
          const line = source.slice(0, match.index).split("\n").length;
          offences.push(`${relative(root, file)}:${line} ${why}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});
