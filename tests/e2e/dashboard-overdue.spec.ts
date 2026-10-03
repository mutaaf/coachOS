import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #14: the Overdue Payments tile never said more than 5, because it
 * counted the five-row preview. It shows every overdue invoice and what they
 * add up to, and "See all" opens Payments on the overdue ones.
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

async function overdue(n: number, amount: number) {
  const { programId } = await seedProgram();
  for (let i = 0; i < n; i++) {
    const { data: p } = await admin
      .from("parents")
      .insert({ first_name: "Parent", last_name: `F${i}`, phone: `+1214557${String(i).padStart(4, "0")}` })
      .select("id")
      .single();
    const { data: s } = await admin.from("students").insert({ first_name: `Kid${i}`, last_name: "Test" }).select("id").single();
    await admin.from("invoices").insert({
      parent_id: p!.id,
      student_id: s!.id,
      program_id: programId,
      amount,
      month: "2026-01",
      due_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      status: "overdue",
    });
  }
}

test("the Overdue Payments tile counts every overdue invoice and links to them", async ({ page }) => {
  await overdue(7, 110);
  await signIn(page);

  const tile = page.getByTestId("stat-overdue-payments");
  await expect(tile).toContainText("7");
  await expect(tile).toContainText("$770.00");

  // The alerts list still shows five, with a way to the rest.
  await expect(page.getByText("Overdue Payment", { exact: true })).toHaveCount(5);
  await page.getByRole("link", { name: "See all 7" }).click();

  await expect(page).toHaveURL(/\/payments\?status=overdue/);
  await expect(page.getByRole("button", { name: "Overdue", exact: true })).toHaveClass(/bg-primary/);
  await expect(page.getByRole("row", { name: /Kid\d+ Test/ })).toHaveCount(7);
});
