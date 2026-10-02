import { test, expect, type Page } from "@playwright/test";
import { admin, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Help, inside CoachOS: guides she can tick through, "Show me" that walks her
 * there, and the auditor's test plan with results saved in the database.
 */

test.beforeEach(truncateAll);
test.afterAll(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("Help is in the menu, guides tick through, and Show me walks there", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Help" }).first().click();
  await expect(page).toHaveURL(/\/help/);
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();

  // Search narrows to one guide and opens it.
  await page.getByLabel("Search help").fill("cash");
  const task = page.getByTestId("help-task");
  await expect(task).toHaveCount(1);
  await task.getByRole("button", { name: /Step 1: mark as done/ }).click();
  await expect(task.getByRole("button", { name: /Step 1: mark as not done/ })).toBeVisible();

  // Ticks survive a reload (kept in this browser).
  await page.reload();
  await page.getByLabel("Search help").fill("cash");
  await expect(page.getByTestId("help-task").getByRole("button", { name: /Step 1: mark as not done/ })).toBeVisible();

  // Show me starts the tour at the right stop.
  await page.getByTestId("help-task").getByRole("button", { name: "Show me" }).click();
  await expect(page).toHaveURL(/\/payments/);
  await expect(page.getByRole("dialog").getByRole("heading", { name: /Invoices and what each status means/ })).toBeVisible();
});

test("the practise tab says which mode Stripe is in and offers test cards", async ({ page }) => {
  await signIn(page);
  await page.goto("/help?tab=practise");
  await expect(page.getByText(/test mode — practise freely/)).toBeVisible();
  await expect(page.getByText("4242 4242 4242 4242", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("practice").first()).toBeVisible();
});

test("a test-plan result is saved in CoachOS and shows as an exception", async ({ page }) => {
  await signIn(page);
  await page.goto("/help?tab=tests");
  const first = page.getByTestId("test-case").first();
  const id = (await first.locator("span.font-mono").first().textContent())!.trim();
  await first.getByRole("button", { name: new RegExp(id) }).click();

  await first.locator('input[type="checkbox"]').first().check();
  await first.getByRole("button", { name: /✗ Fail/ }).click();
  await first.getByLabel(`Notes for ${id}`).fill("Receipt went to the wrong parent");
  await first.getByLabel(`Notes for ${id}`).blur();

  await expect
    .poll(async () => (await admin.from("acceptance_results").select("*").eq("case_id", id).single()).data)
    .toMatchObject({ status: "fail", ticks: [0], notes: "Receipt went to the wrong parent", updated_by: TEST_USER.email });

  await page.reload();
  await expect(page.getByText("Exception log")).toBeVisible();
  await expect(page.getByText("Receipt went to the wrong parent")).toBeVisible();
  await expect(page.getByTestId("test-tally")).toContainText("1");
});

test("Help fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  for (const tab of ["how", "practise", "tests", "reference"]) {
    await page.goto(`/help?tab=${tab}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
});
