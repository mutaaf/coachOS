import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/** Make a program once, put it on at a school; its roster starts empty. On a phone. */

test.beforeAll(ensureTestUser);

test.beforeEach(async () => {
  await truncateAll();
  await admin.from("program_catalog").delete().not("id", "is", null);
  await admin.from("seasons").delete().not("id", "is", null);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("make a program, put it on at a new school in a new season", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/programs");
  await expect(page.getByText("No programs yet")).toBeVisible();

  await page.getByTestId("new-program").click();
  await page.getByLabel("Program name").fill("Lil Dribblers (K–1)");
  await page.getByLabel("Description for parents").fill("Ball-handling and fun.");
  await page.getByRole("button", { name: "4-6 years" }).click();
  await page.getByLabel("Usual monthly fee").fill("100");
  await page.getByTestId("wizard-next").click();

  await page.getByRole("button", { name: "New school" }).click();
  await page.getByLabel("New school’s name").fill("Lakehill Elementary");
  await page.getByRole("button", { name: "Add school", exact: true }).click();
  await page.getByLabel("Season", { exact: true }).selectOption({ label: "+ A new season" });
  await page.getByLabel("New season’s name").fill("Fall 2026");
  await page.getByLabel("Season starts").fill("2026-09-08");
  await page.getByLabel("Season ends").fill("2026-12-11");
  await page.getByRole("button", { name: "Add a weekly practice" }).click();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("switch", { name: "Show on the website" }).click();
  await page.getByRole("button", { name: "Save — 1 school" }).click();
  await expect(page.getByTestId("new-program-done")).toContainText("Lil Dribblers (K–1) is on at 1 school");
  await page.getByRole("link", { name: "Back to Programs" }).click();

  const card = page.getByTestId("program").filter({ hasText: "Lil Dribblers (K–1)" });
  await expect(card).toContainText("$100.00/mo");
  const session = card.getByTestId("session");
  await expect(session).toContainText("Lakehill Elementary");
  await expect(session).toContainText("Tue 3:30–4:30 PM");
  await expect(session).toContainText("Fall 2026");
  await expect(session).toContainText("No roster yet");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("tab", { name: /^Seasons/ }).click();
  await expect(page.getByTestId("season").filter({ hasText: "Fall 2026" })).toContainText("1 session");

  await page.getByRole("tab", { name: /^Programs \(/ }).click();
  await session.click();
  await expect(page).toHaveURL(/\/schools\//);
  await expect(page.getByText("Lil Dribblers (K–1)").first()).toBeVisible();
});

test("edit a program's usual fee from its card", async ({ page }) => {
  await admin.from("program_catalog").insert({ name: "Soccer Stars", default_monthly_fee: 90 });
  await signIn(page);
  await page.goto("/programs");
  await page.getByRole("button", { name: "Edit Soccer Stars" }).click();
  const p = page.getByTestId("program-dialog");
  await p.getByLabel("Usual monthly fee").fill("95");
  await p.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("program").filter({ hasText: "Soccer Stars" })).toContainText("$95.00/mo");
});
