import { describe, it, expect } from "vitest";
import {
  businessToday,
  businessMonth,
  businessDaysAgo,
  isPastDue,
  toISODate,
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
