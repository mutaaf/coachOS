import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Bulk Students asked for each child's parent and then threw them away
 * (issue #33): the child was saved with nobody linked, so nobody to message
 * and no invoices.
 */

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

/** Type a child into the first row of the Bulk Students grid. */
async function fillFirstRow(page: Page, row: { first: string; last: string; parent?: string; phone?: string }) {
  await page.getByRole("button", { name: "Bulk Students" }).click();
  await page.getByPlaceholder("John").first().fill(row.first);
  await page.getByPlaceholder("Smith").first().fill(row.last);
  if (row.parent) await page.getByPlaceholder("Jane Smith").first().fill(row.parent);
  if (row.phone) await page.getByPlaceholder("555-123-4567").first().fill(row.phone);
  await page.getByRole("button", { name: "Import All" }).click();
}

test("Bulk Students saves each child's parent and links them", async ({ page }) => {
  await signIn(page);
  await page.goto("/students");
  await fillFirstRow(page, { first: "Omar", last: "Khan", parent: "Ayesha Khan", phone: "214-555-0150" });
  await expect(page.getByText("Imported 1 record successfully")).toBeVisible();

  await page.keyboard.press("Escape");
  const row = page.getByRole("row", { name: /Omar Khan/ });
  await expect(row.getByText("Ayesha Khan")).toBeVisible();

  const { data: parents } = await admin.from("parents").select("first_name, last_name, phone");
  expect(parents).toEqual([{ first_name: "Ayesha", last_name: "Khan", phone: "+12145550150" }]);
});

test("Bulk Students says when a parent's phone is missing instead of dropping them", async ({ page }) => {
  await signIn(page);
  await page.goto("/students");
  await fillFirstRow(page, { first: "Omar", last: "Khan", parent: "Ayesha Khan" });

  await expect(page.getByText("Row 1: Add Ayesha Khan's phone number, so they can be saved with Omar")).toBeVisible();
  const { count } = await admin.from("students").select("*", { count: "exact", head: true });
  expect(count).toBe(0);
});
