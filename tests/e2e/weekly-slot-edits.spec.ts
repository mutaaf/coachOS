import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";
import { addDays, businessToday } from "../../apps/web/src/lib/dates";

/**
 * Changing a Saturday practice from 9:00 to 9:15 and generating again put two
 * practices on every Saturday. The edit form opened on "Not assigned" and
 * saving cleared the coach, and a practice had nowhere to say who ran it.
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

async function addCoach(firstName: string, phone: string) {
  const { data, error } = await admin
    .from("coaches")
    .insert({ first_name: firstName, last_name: "Coach", phone, pay_type: "per_session", pay_rate: 40, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** A weekly slot on tomorrow's weekday, so its first practice is always ahead. */
async function seedSlot(name: string, coachId: string) {
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name }).eq("id", programId);
  const tomorrow = addDays(businessToday(), 1);
  const day = new Date(`${tomorrow}T12:00:00Z`).getUTCDay();
  const { data, error } = await admin
    .from("schedule_templates")
    .insert({ program_id: programId, day_of_week: day, start_time: "09:00", end_time: "10:00", coach_id: coachId })
    .select("id")
    .single();
  if (error) throw error;
  return { programId, templateId: data.id as string, tomorrow };
}

test("editing a weekly time keeps the coach, moves the practices, and never doubles them", async ({ page }) => {
  const ahmed = await addCoach("Ahmed", "+12145550001");
  const { programId } = await seedSlot("Saturday Squad", ahmed);

  await signIn(page);
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Generate Sessions" }).click();
  await expect(page.getByText(/session\(s\) generated/)).toBeVisible();

  const { data: generated } = await admin.from("sessions").select("coach_id").eq("program_id", programId);
  expect(generated!.length).toBeGreaterThan(0);
  expect(generated!.every((s) => s.coach_id === ahmed)).toBe(true);

  await page.goto("/schedule");
  await page.getByRole("button", { name: "Manage Templates" }).click();
  await page.getByRole("button", { name: "Edit template" }).click();
  await expect(page.locator("#coach_id")).toHaveValue(ahmed);
  await page.locator("#start_time").fill("09:15");
  await page.locator("#end_time").fill("10:15");
  await expect(page.getByLabel(/Also change the practices already on the calendar/)).toBeChecked();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Schedule template updated")).toBeVisible();

  const { data: template } = await admin.from("schedule_templates").select("coach_id").single();
  expect(template!.coach_id).toBe(ahmed);

  await page.goto("/schedule");
  await page.getByRole("button", { name: "Generate Sessions" }).click();
  await expect(page.getByText("0 session(s) generated")).toBeVisible();

  const { data: after } = await admin.from("sessions").select("date, start_time").eq("program_id", programId);
  expect(new Set(after!.map((s) => s.date)).size).toBe(after!.length);
  expect(after!.every((s) => s.start_time.startsWith("09:15"))).toBe(true);
});

test("a practice can be given to the coach who covered it", async ({ page }) => {
  const ahmed = await addCoach("Ahmed", "+12145550001");
  const bilal = await addCoach("Bilal", "+12145550002");
  const { programId, tomorrow } = await seedSlot("Covered Practice", ahmed);
  const { data: session } = await admin
    .from("sessions")
    .insert({ program_id: programId, date: tomorrow, start_time: "09:00", end_time: "10:00", status: "scheduled", coach_id: ahmed })
    .select("id")
    .single();

  await signIn(page);
  await openPractice(page, tomorrow);

  const coach = page.locator("#session_coach");
  await expect(coach).toHaveValue(ahmed);
  await coach.selectOption(bilal);
  await expect(page.getByText("Coach saved")).toBeVisible();

  const { data } = await admin.from("sessions").select("coach_id").eq("id", session!.id).single();
  expect(data!.coach_id).toBe(bilal);

  // Reopened, it still shows who is running it.
  await openPractice(page, tomorrow);
  await expect(page.locator("#session_coach")).toHaveValue(bilal);
});

async function openPractice(page: Page, date: string) {
  await page.goto("/schedule");
  // Tomorrow can be in next week's grid.
  const day = page.locator(`[data-testid="schedule-day"][data-date="${date}"]`);
  await expect(page.getByTestId("schedule-day").first()).toBeVisible();
  if ((await day.count()) === 0) await page.getByRole("button", { name: "Next week" }).click();
  await day.getByText("Covered Practice").click();
}
