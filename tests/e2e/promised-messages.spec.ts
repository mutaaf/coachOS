import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";
import { addDays, businessToday, dayOfWeek } from "../../apps/web/src/lib/dates";

/**
 * Cancelling a practice used to tell nobody, while she believed the families
 * had heard (issue #26). Now each family's message waits in the Outbox; and
 * Settings no longer offers reminder times nothing reads.
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

test("cancelling a practice puts a message to each family in the Outbox", async ({ page }) => {
  const today = businessToday();
  const tomorrow = addDays(today, 1);
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name: "Rainy Hoops" }).eq("id", programId);
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145550150" })
    .select("id")
    .single();
  const { data: child } = await admin.from("students").insert({ first_name: "Mia", last_name: "Garcia" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id, relationship: "parent" });
  await admin.from("enrollments").insert({ student_id: child!.id, program_id: programId, status: "active" });
  await admin
    .from("sessions")
    .insert({ program_id: programId, date: tomorrow, start_time: "16:00", end_time: "17:00", status: "scheduled" });

  await signIn(page);
  await page.goto("/schedule");
  if (dayOfWeek(today) === 6) await page.getByRole("button", { name: "Next week" }).click();
  await page.locator(`[data-testid="schedule-day"][data-date="${tomorrow}"]`).getByText("Rainy Hoops").click();

  await page.getByRole("button", { name: "Cancel Session" }).click();
  await expect(page.getByText("Each family in this program gets a message in your Outbox")).toBeVisible();
  await page.getByPlaceholder(/Reason/).fill("gym closed");
  await page.getByRole("button", { name: "Confirm Cancel" }).click();
  await expect(page.getByText("1 family is waiting in your Outbox to be told")).toBeVisible();

  await page.goto("/messaging?tab=outbox");
  const card = page.getByTestId("outbox-message").first();
  await expect(card).toContainText("Raquel Garcia");
  await expect(card).toContainText("Rainy Hoops");
  await expect(card).toContainText("gym closed");
});

test("Settings no longer offers reminder times that nothing uses", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Messaging" }).click();
  await expect(page.getByText("Practice Reminders", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reminder Time/)).toHaveCount(0);
  await expect(page.getByText("Message Rate Limit (seconds)")).toHaveCount(0);
});
