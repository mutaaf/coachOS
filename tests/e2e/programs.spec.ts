import { test, expect, type Page } from "@playwright/test";
import { admin, truncateAll, TEST_USER } from "../helpers/db";

/** Make a program once, put it on at a school; its roster starts empty. On a phone. */

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
  const p = page.getByTestId("program-dialog");
  await p.getByLabel("Name").fill("Lil Dribblers (K–1)");
  await p.getByLabel("Description for parents").fill("Ball-handling and fun.");
  await p.getByRole("button", { name: "4-6 years" }).click();
  await p.getByLabel("Usual monthly fee").fill("100");
  await p.getByRole("button", { name: "Make program" }).click();
  await expect(page.getByText("Program made")).toBeVisible();

  const card = page.getByTestId("program").filter({ hasText: "Lil Dribblers (K–1)" });
  await expect(card).toContainText("$100.00/mo");
  await card.getByRole("button", { name: "Put it on at a school" }).click();
  const s = page.getByTestId("session-dialog");
  await s.getByLabel("School", { exact: true }).selectOption({ label: "+ A new school" });
  await s.getByLabel("New school’s name").fill("Lakehill Elementary");
  await s.getByLabel("Season", { exact: true }).selectOption({ label: "+ A new season" });
  await s.getByLabel("New season’s name").fill("Fall 2026");
  await s.getByLabel("Starts", { exact: true }).fill("2026-09-08");
  await s.getByLabel("Ends", { exact: true }).fill("2026-12-11");
  await s.getByLabel("Day", { exact: true }).selectOption({ label: "Tuesday" });
  await s.getByRole("button", { name: "Add session" }).click();
  await expect(page.getByText(/is on — its roster starts empty/)).toBeVisible();

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
