import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";
import { addDays, businessToday, dayOfWeek } from "../../apps/web/src/lib/dates";

/**
 * Mark Complete sat beside Save Attendance and threw the register on screen
 * away, completed a practice two weeks off, and a completed practice showed
 * only "0/6" with no way to see or fix who was there.
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

async function seedPractice(name: string, date: string, status = "scheduled") {
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name }).eq("id", programId);
  for (const [first, last] of [["Amina", "Yusuf"], ["Bilal", "Khan"]]) {
    const { data: student } = await admin
      .from("students")
      .insert({ first_name: first, last_name: last })
      .select("id")
      .single();
    await admin
      .from("enrollments")
      .insert({ student_id: student!.id, program_id: programId, status: "active" });
  }
  const { data, error } = await admin
    .from("sessions")
    .insert({ program_id: programId, date, start_time: "16:00", end_time: "17:00", status })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** `weeks` pages forward (or back, if negative) from this week first. */
async function openPractice(page: Page, name: string, date: string, weeks = 0) {
  await page.goto("/schedule");
  for (let i = 0; i < Math.abs(weeks); i++) {
    await page.getByRole("button", { name: weeks > 0 ? "Next week" : "Previous week" }).click();
  }
  await page.locator(`[data-testid="schedule-day"][data-date="${date}"]`).getByText(name).click();
}

function row(page: Page, name: string) {
  return page.getByTestId("register-row").filter({ hasText: name });
}

test("Save & complete keeps the register, and it can be seen and corrected afterwards", async ({ page }) => {
  const today = businessToday();
  const sessionId = await seedPractice("Register Check", today);

  await signIn(page);
  await openPractice(page, "Register Check", today);
  await expect(page.getByRole("button", { name: "Mark Complete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save Attendance" })).toHaveCount(0);

  await row(page, "Bilal").click();
  await expect(row(page, "Bilal")).toContainText("absent");
  await page.getByRole("button", { name: "Save & complete" }).click();
  await expect(page.getByText("Attendance saved and practice complete")).toBeVisible();

  const { data: rows } = await admin.from("attendance").select("status").eq("session_id", sessionId);
  expect(rows!.map((r) => r.status).sort()).toEqual(["absent", "present"]);

  // Reopened, the completed practice still shows who was there.
  await openPractice(page, "Register Check", today);
  await expect(page.getByTestId("session-summary")).toContainText("completed");
  await expect(page.getByTestId("session-summary")).toContainText("1/2");
  await expect(row(page, "Amina")).toContainText("present");
  await expect(row(page, "Bilal")).toContainText("absent");

  // ...and a mistake can be put right.
  await row(page, "Bilal").click();
  await expect(row(page, "Bilal")).toContainText("late");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Attendance saved", { exact: true })).toBeVisible();

  const { data: after } = await admin.from("attendance").select("status").eq("session_id", sessionId);
  expect(after!.map((r) => r.status).sort()).toEqual(["late", "present"]);
});

test("a practice two weeks away can't be completed", async ({ page }) => {
  const later = addDays(businessToday(), 14);
  const sessionId = await seedPractice("Future Check", later);

  await signIn(page);
  // Fourteen days on is always two weeks ahead, whatever today is.
  await openPractice(page, "Future Check", later, 2);

  await expect(page.getByRole("button", { name: "Save & complete" })).toBeDisabled();
  await expect(page.getByText("This practice hasn't happened yet")).toBeVisible();

  const { data } = await admin.from("sessions").select("status").eq("id", sessionId).single();
  expect(data!.status).toBe("scheduled");
});

test("a practice completed with nothing recorded says so rather than showing everyone present", async ({ page }) => {
  const yesterday = addDays(businessToday(), -1);
  await seedPractice("Empty Check", yesterday, "completed");

  await signIn(page);
  // Sunday's yesterday is last week's Saturday.
  await openPractice(page, "Empty Check", yesterday, dayOfWeek(businessToday()) === 0 ? -1 : 0);

  await expect(row(page, "Amina")).toContainText("not marked");
  await expect(page.getByTestId("session-summary")).toContainText("0/2");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await row(page, "Amina").click();
  await expect(row(page, "Amina")).toContainText("present");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
});
