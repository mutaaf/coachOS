import { test, expect } from "@playwright/test";
import { truncateAll } from "../helpers/db";

/**
 * The dashboard holds every child's name, medical notes, and their parents'
 * phone numbers. None of it may be reachable without signing in.
 */

test.afterEach(truncateAll);

const PROTECTED = [
  "/dashboard",
  "/registrations",
  "/students",
  "/schools",
  "/payments",
  "/schedule",
  "/messaging",
  "/marketing",
  "/settings",
];

for (const path of PROTECTED) {
  test(`${path} redirects to login when signed out`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  });
}

test("the registration page stays public", async ({ page }) => {
  // The one route that must NOT be behind the auth gate — parents have no account.
  const response = await page.goto("/join/definitely-not-a-real-slug");

  expect(page.url()).not.toMatch(/\/login/);
  expect(response?.status()).toBe(404);
});

test("the login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("form")).toBeVisible();
});
