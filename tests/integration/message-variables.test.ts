import { describe, it, expect, afterEach, beforeEach, afterAll } from "vitest";
import { renderTemplate, templateVariables } from "shared";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { sendBulkMessages } from "@/lib/actions/messages";
import { GET as cron } from "@/app/api/cron/daily-reminders/route";
import { businessDaysAgo, businessTomorrow, formatClockTime, formatMonthName } from "@/lib/dates";

/**
 * Issue #40: "{{ parent_name }}" with spaces slipped past the guard in Compose
 * and five parents got the raw braces, and the cron's reminders said "2026-09"
 * and "15:30" where a parent expects "September" and "3:30 PM".
 */

const CONFIG = ["auto_generate_invoices", "practice_reminders_enabled", "payment_reminders_enabled", "emails_enabled"];
let saved: { key: string; value: string }[] = [];

beforeEach(async () => {
  const { data } = await admin.from("config").select("key, value").in("key", CONFIG);
  saved = data || [];
  await admin.from("config").update({ value: "false" }).in("key", CONFIG);
});
afterEach(async () => {
  for (const r of saved) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  await truncateAll();
});
afterAll(truncateAll);

const queued = async () => (await admin.from("message_queue").select("message")).data!.map((m) => m.message);
const lena = [{ phone: "+12145550201", name: "Lena Ortiz" }];

describe("renderTemplate", () => {
  it("fills a variable written with spaces or capitals", () => {
    expect(renderTemplate("Hi {{ parent_name }}, {{Parent_Name}} and {{PARENT_NAME }}!", { parent_name: "Lena" })).toBe(
      "Hi Lena, Lena and Lena!"
    );
  });

  it("lists the variables a message uses, however they were typed", () => {
    expect(templateVariables("{{ parent_name }} {{Student_Name}} {{parent_name}}")).toEqual(["parent_name", "student_name"]);
  });
});

describe("Compose", () => {
  it("fills {{ parent_name }} written with spaces", async () => {
    const result = await sendBulkMessages(lena, "Hi {{ parent_name }}, practice moves to 5pm.");
    expect(result).toEqual({ count: 1 });
    expect(await queued()).toEqual(["Hi Lena, practice moves to 5pm."]);
  });

  it("refuses a variable it can't fill, however it is spaced", async () => {
    const result = await sendBulkMessages(lena, "Hi, {{ student_name }} has practice.");
    expect(result).toHaveProperty("error");
    expect(await queued()).toEqual([]);
  });

  it("refuses leftover braces from a half-typed variable", async () => {
    for (const message of ["Hi {{parent_name}, see you.", "Hi parent_name}}, see you.", "Hi {{ parent name }}!"]) {
      const result = await sendBulkMessages(lena, message);
      expect(result, message).toHaveProperty("error");
    }
    expect(await queued()).toEqual([]);
  });
});

describe("Reminder cron", () => {
  const run = () => {
    process.env.CRON_SECRET = "test-cron";
    return cron(new Request("http://localhost/api/cron", { headers: { authorization: "Bearer test-cron" } }) as any);
  };

  async function family(programId: string) {
    const { data: p } = await admin
      .from("parents")
      .insert({ first_name: "Lena", last_name: "Ortiz", phone: "+12145550201" })
      .select("id")
      .single();
    const { data: s } = await admin.from("students").insert({ first_name: "Mia", last_name: "Ortiz" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
    await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
    return { parentId: p!.id as string, studentId: s!.id as string };
  }

  it("says the practice time as 3:30 PM, not 15:30", async () => {
    const { programId } = await seedProgram({});
    await family(programId);
    await admin.from("sessions").insert({ program_id: programId, date: businessTomorrow(), start_time: "15:30", end_time: "16:30", status: "scheduled" });
    await admin.from("config").update({ value: "true" }).eq("key", "practice_reminders_enabled");

    await run();

    const [message] = await queued();
    expect(message).toContain("tomorrow at 3:30 PM");
    expect(message).not.toContain("15:30");
  });

  it("names the month as September, not 2026-09", async () => {
    const { programId } = await seedProgram({ monthlyFee: 100 });
    const { parentId, studentId } = await family(programId);
    await admin.from("invoices").insert({
      parent_id: parentId,
      student_id: studentId,
      program_id: programId,
      month: "2026-09",
      amount: 100,
      due_date: businessDaysAgo(10),
      status: "overdue",
    });
    await admin.from("config").update({ value: "true" }).eq("key", "payment_reminders_enabled");

    await run();

    const [message] = await queued();
    expect(message).toContain("the September payment of $100.00");
    expect(message).not.toContain("2026-09");
  });
});

describe("formatting", () => {
  it("reads clock times and months the way a parent says them", () => {
    expect(formatClockTime("15:30:00")).toBe("3:30 PM");
    expect(formatClockTime("09:05")).toBe("9:05 AM");
    expect(formatClockTime("00:15")).toBe("12:15 AM");
    expect(formatClockTime("12:00")).toBe("12:00 PM");
    expect(formatMonthName("2026-09")).toBe("September");
    expect(formatMonthName("2026-12")).toBe("December");
  });
});
