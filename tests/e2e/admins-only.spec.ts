import { test, expect } from "@playwright/test";
import { ensureOutsider, OUTSIDER } from "../helpers/db";

/** An account without the admin role can't get into CoachOS. */

test("someone with an account but no access is turned away at sign-in and at the door", async ({ page }) => {
  await ensureOutsider();
  await page.goto("/login");
  await page.locator("#email").fill(OUTSIDER.email);
  await page.locator("#password").fill(OUTSIDER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByText("This account doesn't have access to CoachOS")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  for (const path of ["/dashboard", "/students", "/payments"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});
