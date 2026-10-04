import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Accented names are found without typing the accent (issue #23). Searching
 * Students & Parents for "jose" or "nunez" found nobody called José Núñez.
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

test("searching without accents finds José Núñez, Lucía Peña and the García family", async ({ page }) => {
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "María", last_name: "García", phone: "+12145551000" })
    .select("id")
    .single();
  const { data: children } = await admin
    .from("students")
    .insert([
      { first_name: "José", last_name: "Núñez" },
      { first_name: "Lucía", last_name: "Peña" },
    ])
    .select("id");
  await admin.from("student_parents").insert({ student_id: children![1].id, parent_id: parent!.id });

  await signIn(page);
  await page.goto("/students");
  const search = page.getByPlaceholder("Search by name, phone, or email...");

  await search.fill("jose");
  await expect(page.getByRole("row", { name: /José Núñez/ })).toBeVisible();
  await search.fill("nunez");
  await expect(page.getByRole("row", { name: /José Núñez/ })).toBeVisible();
  await search.fill("pena");
  await expect(page.getByRole("row", { name: /Lucía Peña/ })).toBeVisible();
  // A child is found by their parent's name, too.
  await search.fill("garcia");
  await expect(page.getByRole("row", { name: /Lucía Peña/ })).toBeVisible();

  await page.getByRole("tab", { name: /^Parents \(/ }).click();
  await search.fill("maria garcia");
  await expect(page.getByRole("row", { name: /María García/ })).toBeVisible();
});
