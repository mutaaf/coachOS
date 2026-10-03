import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * An edit dialog opens on the record she clicked (issue #10). They stayed
 * mounted with nothing in them, kept that empty state, and saved it: fixing a
 * Zelle parent's phone switched them to cash, and an hourly coach became
 * per-session.
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

test("editing a Zelle parent's phone keeps them on Zelle", async ({ page }) => {
  const { data: parent } = await admin
    .from("parents")
    .insert({
      first_name: "Amina",
      last_name: "Khan",
      phone: "+12145550101",
      preferred_payment: "zelle",
      zelle_identifier: "amina@example.test",
    })
    .select("id")
    .single();

  await signIn(page);
  await page.goto("/students");
  await page.getByRole("button", { name: /^Parents \(/ }).click();
  await page.getByRole("row", { name: /Amina Khan/ }).getByTitle("Edit parent").click();

  await expect(page.getByLabel("Preferred Payment")).toHaveValue("zelle");
  await expect(page.getByLabel("Zelle Email/Phone")).toHaveValue("amina@example.test");
  await page.getByLabel("Phone *").fill("+12145550199");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("Parent updated")).toBeVisible();

  const { data } = await admin
    .from("parents")
    .select("phone, preferred_payment, zelle_identifier")
    .eq("id", parent!.id)
    .single();
  expect(data).toEqual({
    phone: "+12145550199",
    preferred_payment: "zelle",
    zelle_identifier: "amina@example.test",
  });
});

test("editing an hourly coach keeps them hourly", async ({ page }) => {
  const { data: coach } = await admin
    .from("coaches")
    .insert({ first_name: "Jose", last_name: "Diaz", phone: "+12145550202", pay_type: "hourly", pay_rate: 25 })
    .select("id")
    .single();

  await signIn(page);
  await page.goto("/coaches");
  await page.getByRole("button", { name: "Edit Jose Diaz" }).click();

  await expect(page.getByLabel("Paid")).toHaveValue("hourly");
  await expect(page.getByLabel("Rate per hour")).toHaveValue("25");
  await page.getByLabel("Notes").fill("Saturdays only");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Coach updated")).toBeVisible();

  const { data } = await admin.from("coaches").select("pay_type, pay_rate, notes").eq("id", coach!.id).single();
  expect(data).toMatchObject({ pay_type: "hourly", notes: "Saturdays only" });
  expect(Number(data!.pay_rate)).toBe(25);
});

test("opening a second coach after the first shows the second coach's pay", async ({ page }) => {
  await admin.from("coaches").insert([
    { first_name: "Jose", last_name: "Diaz", phone: "+12145550202", pay_type: "hourly", pay_rate: 25 },
    { first_name: "Sam", last_name: "Lee", phone: "+12145550203", pay_type: "per_session", pay_rate: 40 },
  ]);

  await signIn(page);
  await page.goto("/coaches");
  await page.getByRole("button", { name: "Edit Sam Lee" }).click();
  await expect(page.getByLabel("Paid")).toHaveValue("per_session");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Edit Jose Diaz" }).click();
  await expect(page.getByLabel("Paid")).toHaveValue("hourly");
});
