import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { updateMultipleConfigs } from "@/lib/actions/config";
import { billFirstMonth } from "@/lib/invoices";
import { addDays, businessMonth, businessToday } from "@/lib/dates";

/**
 * Issue #27: Settings said "in effect now" for ten values nothing read. A due
 * day of 45 was accepted while invoices stayed due on the 1st, and "Send Email
 * As" took anything, which would stop every parent email. The settings that
 * matter now do what they say; the rest are gone.
 */

const KEYS = ["payment_due_day", "default_monthly_fee", "email_from"];
let before: { key: string; value: string }[] = [];
beforeAll(async () => {
  before = (await admin.from("config").select("key, value").in("key", KEYS)).data || [];
});
afterEach(async () => {
  for (const r of before) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  await truncateAll();
});

let n = 0;
async function enrolled(programId: string, enrolledAt?: string) {
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Sara", last_name: "Yusuf", phone: `+1214556${String(++n).padStart(4, "0")}` })
    .select("id")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: "Amina", last_name: "Yusuf" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({
    student_id: s!.id,
    program_id: programId,
    status: "active",
    ...(enrolledAt ? { enrolled_at: enrolledAt } : {}),
  });
  return { studentId: s!.id as string, parentId: p!.id as string };
}

async function dueDates(programId: string) {
  const { data } = await admin.from("invoices").select("due_date").eq("program_id", programId).order("month");
  return data!.map((i) => i.due_date);
}

const setDueDay = (day: string) => admin.from("config").update({ value: day }).eq("key", "payment_due_day");

describe("Payment Due Day", () => {
  it("is the day the month's invoices fall due", async () => {
    await setDueDay("15");
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-01-01T17:00:00Z");
    await generateMonthlyInvoices("2026-11");
    expect(await dueDates(programId)).toEqual(["2026-11-15"]);
  });

  it("still gives a child who joins after it a week to pay", async () => {
    await setDueDay("5");
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-10-10T17:00:00Z");
    await generateMonthlyInvoices("2026-10");
    expect(await dueDates(programId)).toEqual(["2026-10-17"]);
  });

  it("applies to a child added mid-month, if it is more than a week away", async () => {
    await setDueDay("28");
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const { studentId, parentId } = await enrolled(programId);
    await billFirstMonth(admin, { studentId, programId, parentId });
    const week = addDays(businessToday(), 7);
    const dueDay = `${businessMonth()}-28`;
    expect(await dueDates(programId)).toEqual([week > dueDay ? week : dueDay]);
  });

  it("is the 1st when it is left blank", async () => {
    await setDueDay("");
    const { programId } = await seedProgram({ monthlyFee: 100 });
    await enrolled(programId, "2026-01-01T17:00:00Z");
    await generateMonthlyInvoices("2026-11");
    expect(await dueDates(programId)).toEqual(["2026-11-01"]);
  });

  it("refuses a day every month doesn't have", async () => {
    for (const bad of ["45", "0", "29", "31", "2.5", "-3"]) {
      const result = await updateMultipleConfigs([{ key: "payment_due_day", value: bad }]);
      expect(result, bad).toHaveProperty("error");
    }
    const { data } = await admin.from("config").select("value").eq("key", "payment_due_day").single();
    expect(data!.value).toBe(before.find((r) => r.key === "payment_due_day")!.value);
    expect(await updateMultipleConfigs([{ key: "payment_due_day", value: "28" }])).toMatchObject({ success: true });
  });
});

describe("Send Email As", () => {
  it("refuses anything that isn't a name and an address at the sending domain", async () => {
    for (const bad of [
      "garbage",
      "payments@risingstars.training",
      "Rising Stars <payments@gmail.com>",
      "Rising Stars <payments@risingstars>",
      "Rising Stars payments@risingstars.training",
      "<payments@risingstars.training>",
      "Rising Stars <payments@evil-risingstars.training>",
    ]) {
      const result = await updateMultipleConfigs([{ key: "email_from", value: bad }]);
      expect(result, bad).toHaveProperty("error");
    }
    const { data } = await admin.from("config").select("value").eq("key", "email_from").single();
    expect(data!.value).toBe(before.find((r) => r.key === "email_from")!.value);
  });

  it("accepts a name and an address at the domain or one beneath it", async () => {
    for (const good of ["Rising Stars <payments@risingstars.training>", "Coach Amal <hello@send.risingstars.training>"]) {
      expect(await updateMultipleConfigs([{ key: "email_from", value: good }]), good).toMatchObject({ success: true });
    }
  });
});

describe("settings nothing used", () => {
  it("are off the Settings page, so it shows only what the app does", async () => {
    // 'internal' settings are never shown for editing.
    const { data } = await admin.from("config").select("key").neq("category", "internal");
    const keys = data!.map((r) => r.key);
    for (const dead of [
      "coach_name",
      "coach_phone",
      "day_before_reminder_time",
      "morning_reminder_time",
      "welcome_message_enabled",
      "message_rate_limit_seconds",
      "default_session_duration_minutes",
      "auto_generate_sessions_weeks",
    ]) {
      expect(keys, dead).not.toContain(dead);
    }
    expect(keys).toContain("payment_due_day");
    expect(keys).toContain("default_monthly_fee");
  });
});
