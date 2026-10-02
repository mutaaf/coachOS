import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, userMetadata, TEST_USER } from "../helpers/db";

/**
 * After a release she sees what's new — once — with "Show me" into the tour;
 * and "Report a problem" reaches the people fixing things, then tells her when
 * it's fixed.
 */

test.beforeEach(async () => {
  await truncateAll();
  await ensureTestUser();
});
test.afterAll(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function release(version: string, title: string, notes: { text: string; tourStep?: string }[]) {
  const { error } = await admin.from("releases").insert({ version, title, notes, summary: "" });
  if (error) throw error;
}

test("what's new shows once, tours only the new stops, and is remembered", async ({ page }) => {
  await release("1.0.0", "Field Day", [{ text: "Everything so far" }]);
  await release("1.1.0", "Net Gains", [
    { text: "Record cash from anyone, even someone new", tourStep: "record-payment" },
    { text: "Help has a What's new tab" },
  ]);
  const userId = await ensureTestUser();

  await signIn(page);
  const dialog = page.getByTestId("whats-new");
  await expect(dialog).toBeVisible();
  // The first time, only the latest — not the whole history.
  await expect(dialog.getByText("Net Gains")).toBeVisible();
  await expect(dialog.getByText("Field Day")).toHaveCount(0);
  await expect(page.getByTestId("app-version").first()).toContainText("v1.1.0");

  await dialog.getByRole("button", { name: "Show me what’s new" }).click();
  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", { name: /Money from someone new/ })).toBeVisible();
  await expect(tour.getByText("1 of 1")).toBeVisible();
  await expect(page).toHaveURL(/\/payments/);
  await expect.poll(async () => (await userMetadata(userId)).last_seen_release).toBe("1.1.0");

  await page.keyboard.press("Escape");
  await page.goto("/dashboard");
  await expect(page.getByTestId("whats-new")).toHaveCount(0);

  // The next release shows just itself.
  await release("1.1.1", "No Foul Play", [{ text: "Fixed: the Record button" }]);
  await page.reload();
  await expect(page.getByTestId("whats-new").getByText("No Foul Play")).toBeVisible();
  await expect(page.getByTestId("whats-new").getByText("Net Gains")).toHaveCount(0);
});

test("a problem she reports is saved, and shows fixed once a release fixes it", async ({ page }) => {
  await signIn(page);
  await page.goto("/payments");
  await page.getByRole("button", { name: "Report a problem" }).first().click();
  const d = page.getByTestId("report-problem");
  await d.getByLabel(/What happened/).fill("I tapped Record for Raquel and nothing happened");
  await d.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks — sent")).toBeVisible();

  const { data: report } = await admin.from("problem_reports").select("message, page, reported_by, status").single();
  expect(report).toEqual({
    message: "I tapped Record for Raquel and nothing happened",
    page: "/payments",
    reported_by: TEST_USER.email,
    status: "new",
  });

  await page.goto("/help?tab=new");
  await expect(page.getByTestId("my-report")).toContainText("Being looked at");

  // A release that fixes its issue marks it fixed.
  await admin.from("problem_reports").update({ issue_number: 42, status: "sent" }).not("id", "is", null);
  await release("1.2.0", "Back of the Net", [{ text: "Record works every time" }]);
  await admin.from("problem_reports").update({ status: "fixed", fixed_in: "1.2.0" }).eq("issue_number", 42);
  await page.reload();
  await expect(page.getByTestId("my-report")).toContainText("Fixed in v1.2.0");
});
