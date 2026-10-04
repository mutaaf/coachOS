import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, register, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Phone numbers are one number, however they were typed (issue #22).
 * "214.555.1000" saved as typed became wa.me/2145551000 on the Registrations
 * and Coaches pages — no 1, so WhatsApp dialled another country — and "12" was
 * accepted as a parent's phone.
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

test("WhatsApp links on Registrations and Coaches dial the US number", async ({ page }) => {
  const { programId } = await seedProgram();
  // As an older row would have it: saved exactly as typed.
  await register(programId, "Mia", { parentPhone: "214.555.1000" });
  await admin
    .from("coaches")
    .insert({ first_name: "Ahmed", last_name: "Rahman", phone: "972.891.8266", status: "active" });

  await signIn(page);
  await page.goto("/registrations");
  await expect(page.getByRole("link", { name: "(214) 555-1000" })).toHaveAttribute("href", "https://wa.me/12145551000");

  await page.goto("/coaches");
  await expect(page.getByRole("link", { name: "(972) 891-8266" })).toHaveAttribute("href", "https://wa.me/19728918266");
});

test("a parent's phone is checked, saved as one number, and found by search however it's typed", async ({ page }) => {
  await signIn(page);
  await page.goto("/students");
  await page.getByRole("button", { name: "Add Parent" }).click();
  await page.getByLabel("First Name").fill("Raquel");
  await page.getByLabel("Last Name").fill("Garcia");
  await page.getByLabel("Phone *").fill("12");
  await page.getByRole("button", { name: "Add Parent" }).last().click();
  await expect(page.getByText(/That phone number doesn't look right/)).toBeVisible();

  await page.getByLabel("Phone *").fill("214.555.1000");
  await page.getByRole("button", { name: "Add Parent" }).last().click();
  await expect
    .poll(async () => (await admin.from("parents").select("phone")).data)
    .toEqual([{ phone: "+12145551000" }]);

  await page.getByRole("tab", { name: /^Parents \(/ }).click();
  await page.getByPlaceholder("Search by name, phone, or email...").fill("(214) 555");
  await expect(page.getByRole("row", { name: /Raquel Garcia/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Raquel Garcia/ })).toContainText("(214) 555-1000");
});

test("a family on /join is asked again for a number that isn't one", async ({ page }) => {
  const { slug } = await seedProgram({ capacity: 12 });
  await page.goto(`/join/${slug}`);

  await page.getByLabel("First name").first().fill("Mia");
  await page.getByLabel("Last name").first().fill("Garcia");
  await page.getByLabel("First name").nth(1).fill("Raquel");
  await page.getByLabel("Last name").nth(1).fill("Garcia");
  await page.getByLabel("Mobile number").fill("214.555.1000 call after 5");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText(/That phone number doesn't look right/)).toBeVisible();

  await page.getByLabel("Mobile number").fill("214.555.1000");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: /is in! 🎉/ })).toBeVisible();
  const { data } = await admin.from("registrations").select("parent_phone");
  expect(data).toEqual([{ parent_phone: "+12145551000" }]);
});
