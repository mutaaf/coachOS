import { test, expect, type Page } from "@playwright/test";
import {
  admin,
  ensureTestUser,
  issueAttendanceLink,
  seedProgram,
  truncateAll,
  TEST_USER,
} from "../helpers/db";
import {
  addDays,
  businessInstant,
  businessToday,
  dayOfWeek,
  formatBusinessTime,
} from "../../apps/web/src/lib/dates";

/**
 * A link made at 7:29pm for a 9am practice ran out at 7:29am, locking the
 * coach out at the field; and a cancelled practice still opened in the
 * coach's register and saved attendance.
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

async function seedSession(name: string, date: string, start: string, end: string) {
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name }).eq("id", programId);
  const { data: student } = await admin
    .from("students")
    .insert({ first_name: "Amina", last_name: "Yusuf" })
    .select("id")
    .single();
  await admin
    .from("enrollments")
    .insert({ student_id: student!.id, program_id: programId, status: "active" });
  const { data, error } = await admin
    .from("sessions")
    .insert({ program_id: programId, date, start_time: start, end_time: end, status: "scheduled" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function openSession(page: Page, name: string, date: string) {
  await page.goto("/schedule");
  // Saturday's tomorrow is next week's Sunday.
  if (date > businessToday() && dayOfWeek(businessToday()) === 6) {
    await page.getByRole("button", { name: "Next week" }).click();
  }
  await page.locator(`[data-testid="schedule-day"][data-date="${date}"]`).getByText(name).click();
}

async function unlock(page: Page, link: { token: string; passcode: string }) {
  await page.goto(`/s/${link.token}`);
  await page.getByLabel("Passcode").fill(link.passcode);
  await page.getByRole("button", { name: /open register/i }).click();
}

test("a link for tomorrow morning's practice works until after it ends", async ({ page }) => {
  const tomorrow = addDays(businessToday(), 1);
  await seedSession("Morning Check", tomorrow, "09:00", "10:00");

  await signIn(page);
  await openSession(page, "Morning Check", tomorrow);
  await page.getByRole("button", { name: "Coach link" }).click();

  const until = formatBusinessTime(new Date(businessInstant(tomorrow, "10:00").getTime() + 6 * 3_600_000));
  await expect(page.getByText(`Works until ${until}.`)).toBeVisible();
  await expect(page.getByText(/valid for 12 hours/i)).toHaveCount(0);
});

test("cancelling a practice turns off the link she sent the coach", async ({ page }) => {
  const today = businessToday();
  const sessionId = await seedSession("Rained Out", today, "16:00", "17:00");
  const link = await issueAttendanceLink(sessionId);

  await signIn(page);
  await openSession(page, "Rained Out", today);
  await page.getByRole("button", { name: "Cancel practice" }).click();
  await page.getByPlaceholder(/reason/i).fill("Gym closed");
  await page.getByRole("button", { name: "Confirm Cancel" }).click();
  await expect(page.getByText("Practice cancelled")).toBeVisible();

  await unlock(page, link);
  await expect(page.getByText(/turned off|cancelled/i).first()).toBeVisible();
  await expect(page.getByText("Yusuf")).toHaveCount(0);
});

test("the coach is told a cancelled practice has no register", async ({ page }) => {
  const sessionId = await seedSession("Called Off", businessToday(), "16:00", "17:00");
  const link = await issueAttendanceLink(sessionId);
  await admin.from("sessions").update({ status: "cancelled" }).eq("id", sessionId);

  await unlock(page, link);

  await expect(page.getByText("This practice was cancelled, so there is no register to take.")).toBeVisible();
  await expect(page.getByText("Yusuf")).toHaveCount(0);
});
