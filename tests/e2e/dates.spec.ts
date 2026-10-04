import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";
import { addDays, businessToday, dayOfWeek } from "../../apps/web/src/lib/dates";

/**
 * Dates are stored as plain days ("2026-10-06") and she reads them in Dallas.
 *
 * `new Date("2026-10-06")` is midnight in London, which is still Monday
 * evening in Dallas, so Tuesday practices showed as Monday; and after 7pm the
 * Schedule grid took "today" from the UTC date and slid every practice a
 * column. These run the browser on Dallas time, as hers is.
 */

test.use({ timezoneId: "America/Chicago" });
test.beforeAll(ensureTestUser);
test.beforeEach(truncateAll);
test.afterAll(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Half past seven this evening in Dallas — after UTC has rolled over to tomorrow. */
function thisEveningInDallas(): Date {
  const today = businessToday();
  for (const offset of ["-05:00", "-06:00"]) {
    const d = new Date(`${today}T19:30:00${offset}`);
    if (businessToday(d) === today && d.toISOString().slice(0, 10) !== today) return d;
  }
  throw new Error("could not place 7:30pm in Dallas");
}

/** "Tuesday, October 6" for a stored day, read as that day. */
function longDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function numericDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

async function seedSession(programId: string, date: string) {
  const { data, error } = await admin
    .from("sessions")
    .insert({ program_id: programId, date, start_time: "16:00", end_time: "17:00", status: "scheduled" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

test("after 7pm the Schedule still puts today's practice under today", async ({ page }) => {
  const today = businessToday();
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name: "Evening Check" }).eq("id", programId);
  await seedSession(programId, today);

  await signIn(page);
  await page.clock.setFixedTime(thisEveningInDallas());
  await page.goto("/schedule");

  const todayColumn = page.locator('[data-testid="schedule-day"][aria-current="date"]');
  await expect(todayColumn).toHaveCount(1);
  await expect(todayColumn).toHaveAttribute("data-date", today);
  await expect(todayColumn.getByText(String(Number(today.slice(8))), { exact: true })).toBeVisible();
  await expect(todayColumn.getByText("Evening Check")).toBeVisible();
});

test("the session dialog names the practice's own day, and the coach link says which", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const today = businessToday();
  const tomorrow = addDays(today, 1);
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name: "Tomorrow Check" }).eq("id", programId);
  await seedSession(programId, tomorrow);

  await signIn(page);
  await page.goto("/schedule");
  // Saturday's tomorrow is next week's Sunday.
  if (dayOfWeek(today) === 6) await page.getByRole("button", { name: "Next week" }).click();

  await page.locator(`[data-testid="schedule-day"][data-date="${tomorrow}"]`).getByText("Tomorrow Check").click();
  await expect(page.getByText(`${longDay(tomorrow)} at 16:00`)).toBeVisible();

  await page.getByRole("button", { name: "Coach link" }).click();
  await page.getByRole("button", { name: "Copy link and passcode" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Register for tomorrow's practice:/);
});

test("the school page shows program dates and sessions on their own days", async ({ page }) => {
  const { schoolId, programId } = await seedProgram();
  await admin.from("programs").update({ start_date: "2026-09-01", end_date: "2027-05-28" }).eq("id", programId);
  const day = addDays(businessToday(), 3);
  await seedSession(programId, day);

  await signIn(page);
  await page.goto(`/schools/${schoolId}`);
  await expect(page.getByText("9/1/2026 - 5/28/2027")).toBeVisible();

  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const [y, m, d] = day.split("-").map(Number);
  const short = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  await expect(page.getByText(short, { exact: true })).toBeVisible();
});

test("a follow-up due today shows today's date and is not overdue; yesterday's is", async ({ page }) => {
  const today = businessToday();
  const yesterday = addDays(today, -1);
  await admin.from("leads").delete().like("school_name", "Dates Check%");
  await admin.from("leads").insert([
    { school_name: "Dates Check Today", stage: "identified", next_follow_up: today },
    { school_name: "Dates Check Late", stage: "identified", next_follow_up: yesterday },
  ]);
  try {
    await signIn(page);
    await page.goto("/marketing");

    const due = page.getByText(`Follow up: ${numericDay(today)}`);
    await expect(due).toBeVisible();
    await expect(due).not.toHaveClass(/bg-red-100/);

    const late = page.getByText(`Follow up: ${numericDay(yesterday)}`);
    await expect(late).toBeVisible();
    await expect(late).toHaveClass(/bg-red-100/);
  } finally {
    await admin.from("leads").delete().like("school_name", "Dates Check%");
  }
});
