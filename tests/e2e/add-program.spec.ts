import { test, expect } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The owner's weekly job: add a program at a school and get a link to paste
 * into that school's WhatsApp group.
 *
 * This is the flow the whole system exists to serve, so it is tested through
 * the real UI — signing in, filling the form, and checking that the link the
 * dashboard hands back actually works for a parent.
 */

test.beforeAll(ensureTestUser);
test.afterEach(truncateAll);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("adding a program with registration open produces a working parent link", async ({
  page,
}) => {
  const { data: school } = await admin
    .from("schools")
    .insert({ name: "Al-Noor Academy", status: "active" })
    .select("id")
    .single();

  await signIn(page);
  await page.goto(`/schools/${school!.id}`);

  await page.getByRole("button", { name: /add program|create first program/i }).first().click();

  await page.locator("#name").fill("Basketball Fundamentals - Tuesdays");
  await page.locator("#monthly_fee").fill("150");
  await page.locator("#capacity").fill("12");
  await page.locator("#location").fill("Al-Noor Gym");
  await page.getByRole("switch", { name: /open registration/i }).click();

  await page.getByRole("button", { name: "Create Program", exact: true }).click();

  // The program is registerable, and the slug was generated rather than typed.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("programs")
        .select("public_slug, capacity, registration_open")
        .eq("school_id", school!.id)
        .maybeSingle();
      return data;
    })
    .toMatchObject({ capacity: 12, registration_open: true });

  const { data: program } = await admin
    .from("programs")
    .select("public_slug")
    .eq("school_id", school!.id)
    .single();

  expect(program!.public_slug).toBe("al-noor-academy-basketball-fundamentals-tuesdays");

  // The link a parent would be sent works, and shows what they need to decide.
  await page.goto(`/join/${program!.public_slug}`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Basketball Fundamentals"
  );
  await expect(page.getByText("12 of 12 left")).toBeVisible();
  await expect(page.getByText("Al-Noor Gym")).toBeVisible();
});

test("a program left closed has no working link yet", async ({ page }) => {
  const { data: school } = await admin
    .from("schools")
    .insert({ name: "Test Academy", status: "active" })
    .select("id")
    .single();

  await signIn(page);
  await page.goto(`/schools/${school!.id}`);

  await page.getByRole("button", { name: /add program|create first program/i }).first().click();
  await page.locator("#name").fill("Not Open Yet");
  await page.getByRole("button", { name: "Create Program", exact: true }).click();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from("programs")
        .select("registration_open")
        .eq("school_id", school!.id)
        .maybeSingle();
      return data?.registration_open;
    })
    .toBe(false);

  // The link exists but the page declines to show a form.
  const { data: program } = await admin
    .from("programs")
    .select("public_slug")
    .eq("school_id", school!.id)
    .single();

  await page.goto(`/join/${program!.public_slug}`);
  await expect(page.getByText(/registration isn't open yet/i)).toBeVisible();
});

test("two programs with the same name at one school get distinct links", async ({
  page,
}) => {
  const { data: school } = await admin
    .from("schools")
    .insert({ name: "Same Name School", status: "active" })
    .select("id")
    .single();

  await signIn(page);

  for (let i = 0; i < 2; i++) {
    await page.goto(`/schools/${school!.id}`);
    await page.getByRole("button", { name: /add program|create first program/i }).first().click();
    await page.locator("#name").fill("Soccer Skills");
    await page.getByRole("button", { name: "Create Program", exact: true }).click();
    await expect
      .poll(async () => {
        const { count } = await admin
          .from("programs")
          .select("*", { count: "exact", head: true })
          .eq("school_id", school!.id);
        return count;
      })
      .toBe(i + 1);
  }

  const { data: programs } = await admin
    .from("programs")
    .select("public_slug")
    .eq("school_id", school!.id);

  const slugs = programs!.map((p) => p.public_slug).sort();
  expect(new Set(slugs).size).toBe(2);
  expect(slugs).toEqual([
    "same-name-school-soccer-skills",
    "same-name-school-soccer-skills-2",
  ]);
});
