import { test, expect } from "@playwright/test";
import { admin, availability, register, seedProgram, truncateAll } from "../helpers/db";

/**
 * The path a parent actually walks: open the link from a WhatsApp group, fill in
 * the form, find out whether their child has a seat.
 */

test.afterEach(truncateAll);

test("a parent registers and is told they have a seat", async ({ page }) => {
  const { slug } = await seedProgram({ capacity: 12, monthlyFee: 150 });

  await page.goto(`/join/${slug}`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Test Program");
  await expect(page.getByText("12 of 12 left")).toBeVisible();

  await page.getByLabel("First name").first().fill("Amina");
  await page.getByLabel("Last name").first().fill("Yusuf");
  await page.getByLabel("Grade").fill("3rd");
  await page.getByLabel("First name").nth(1).fill("Sara");
  await page.getByLabel("Last name").nth(1).fill("Yusuf");
  await page.getByLabel("WhatsApp number").fill("(214) 555-0123");

  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByText("You're in.")).toBeVisible();

  const { data } = await admin
    .from("registrations")
    .select("child_first_name, parent_phone, status, child_grade")
    .single();

  expect(data!.child_first_name).toBe("Amina");
  expect(data!.child_grade).toBe("3rd");
  expect(data!.status).toBe("confirmed");
});

test("a full program offers the waitlist rather than turning a parent away", async ({ page }) => {
  const { programId, slug } = await seedProgram({ capacity: 1 });
  await register(programId, "AlreadySeated");

  await page.goto(`/join/${slug}`);

  // Anchored so it matches the seat count, not the "This program is full" notice.
  await expect(page.getByText(/^Full$/)).toBeVisible();
  await expect(page.getByText(/you'll be added to the waitlist/i)).toBeVisible();

  await page.getByLabel("First name").first().fill("Zayd");
  await page.getByLabel("Last name").first().fill("Ali");
  await page.getByLabel("First name").nth(1).fill("Hana");
  await page.getByLabel("Last name").nth(1).fill("Ali");
  await page.getByLabel("WhatsApp number").fill("(214) 555-0199");

  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByText("You're on the waitlist.")).toBeVisible();
  // First in line, since nobody was waiting before them.
  await expect(page.locator("strong")).toHaveText("1");

  const seats = await availability(programId);
  expect(seats.seats_taken).toBe(1);
  expect(seats.waitlist_count).toBe(1);
});

test("a closed program does not show the form", async ({ page }) => {
  const { slug } = await seedProgram({ capacity: 5, registrationOpen: false });

  await page.goto(`/join/${slug}`);

  await expect(page.getByText(/registration isn't open yet/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /register/i })).toHaveCount(0);
});

test("an unknown program link 404s rather than erroring", async ({ page }) => {
  const response = await page.goto("/join/no-such-program");
  expect(response?.status()).toBe(404);
});

test("the same child cannot be registered twice by a double submit", async ({ page }) => {
  const { programId, slug } = await seedProgram({ capacity: 12 });
  await register(programId, "Amina", {
    childLastName: "Yusuf",
    parentPhone: "(214) 555-0123",
  });

  await page.goto(`/join/${slug}`);

  await page.getByLabel("First name").first().fill("Amina");
  await page.getByLabel("Last name").first().fill("Yusuf");
  await page.getByLabel("First name").nth(1).fill("Sara");
  await page.getByLabel("Last name").nth(1).fill("Yusuf");
  await page.getByLabel("WhatsApp number").fill("(214) 555-0123");

  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByText(/already have a registration for this child/i)).toBeVisible();

  const { count } = await admin
    .from("registrations")
    .select("*", { count: "exact", head: true });
  expect(count).toBe(1);
});
