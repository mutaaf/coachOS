import { test, expect, type Page } from "@playwright/test";
import { admin, adminPublic, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/** The website's programs, managed from CoachOS: add from a program, edit, take down. */

test.beforeEach(truncateAll);
test.afterEach(async () => {
  await adminPublic.from("programs").delete().like("title", "%E2E%");
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("add a listing from a CoachOS program, edit it, and take it down", async ({ page }) => {
  const { programId } = await seedProgram({ monthlyFee: 110, capacity: 10 });
  const title = "Lil Dribblers E2E";
  await admin.from("programs").update({ name: title, start_date: "2026-09-08", end_date: "2026-12-11" }).eq("id", programId);

  await signIn(page);
  await page.getByRole("link", { name: "Website" }).first().click();
  await expect(page).toHaveURL(/\/website/);

  await page.getByTestId("add-listing").click();
  const d = page.getByTestId("listing-dialog");
  await d.getByLabel("CoachOS program").selectOption(programId);
  // Filled in from the program.
  await expect(d.getByLabel("Title")).toHaveValue(title);
  await expect(d.getByLabel("Price")).toHaveValue("$110/month");
  await expect(d.getByLabel("Dates as parents see them")).toHaveValue("September 8 – December 11, 2026");
  await d.getByLabel("Description").fill("Fun soccer for little ones.");
  await d.getByRole("button", { name: "4-6 years" }).click();
  await d.getByRole("button", { name: "Add to website" }).click();
  await expect(page.getByText("Added to the website")).toBeVisible();

  const card = page.getByTestId("listing").filter({ hasText: title });
  await expect(card).toContainText("10 of 10 places left (live)");
  await expect(card).toContainText("sign-ups go straight into CoachOS");
  const { data: row } = await adminPublic.from("programs").select("ops_program_id, age_groups, description").like("title", "%E2E%").single();
  expect(row).toEqual({ ops_program_id: programId, age_groups: ["4-6 years"], description: "Fun soccer for little ones." });

  await card.getByRole("button", { name: "Edit" }).click();
  await d.getByLabel("Title").fill(`${title} — Fall`);
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("listing").filter({ hasText: "E2E — Fall" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("listing").filter({ hasText: "E2E — Fall" }).getByRole("button", { name: /Delete/ }).click();
  await expect(page.getByText("Taken off the website")).toBeVisible();
  await expect(page.getByTestId("listing").filter({ hasText: "E2E" })).toHaveCount(0);
});

test("the Website page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/website");
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
