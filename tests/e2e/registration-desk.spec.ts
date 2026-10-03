import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, register, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The buttons on Registrations do what they say (issue #25): no "Mark paid"
 * with no money behind it, Add to roster bills the family, the X asks first
 * and can take the child off the roster, Restore undoes it, and the waitlist
 * is served in line order.
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

async function registration(child: string) {
  const { data } = await admin.from("registrations").select("*").eq("child_first_name", child).single();
  return data!;
}

test("Add to roster bills the family, and Paid shows only once money is recorded", async ({ page }) => {
  const { programId } = await seedProgram({ monthlyFee: 150 });
  await register(programId, "Amina", { childLastName: "Yusuf" });

  await signIn(page);
  await page.goto("/registrations");
  const card = page.locator("div.rounded-xl", { hasText: "Amina Yusuf" });
  await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0);

  await card.getByRole("button", { name: "Add to roster" }).click();
  await expect(card.getByText("Enrolled")).toBeVisible();
  await expect(card.getByText("Paid", { exact: true })).toHaveCount(0);

  const { data: invoices } = await admin.from("invoices").select("id, amount, status").eq("program_id", programId);
  expect(invoices).toMatchObject([{ amount: 150, status: "pending" }]);

  await admin.from("payments").insert({ invoice_id: invoices![0].id, amount: 150, method: "zelle" });
  await admin.from("invoices").update({ status: "paid" }).eq("id", invoices![0].id);
  await page.reload();
  await expect(card.getByText("Paid", { exact: true })).toBeVisible();
});

test("Cancel asks first, takes the child off the roster, and Restore puts them back", async ({ page }) => {
  const { programId } = await seedProgram({ monthlyFee: 150 });
  await register(programId, "Amina", { childLastName: "Yusuf" });

  await signIn(page);
  await page.goto("/registrations");
  const card = page.locator("div.rounded-xl", { hasText: "Amina Yusuf" });
  await card.getByRole("button", { name: "Add to roster" }).click();
  await expect(card.getByText("Enrolled")).toBeVisible();

  // Changing her mind leaves everything as it was.
  await card.getByRole("button", { name: "Cancel Amina's registration" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  expect((await registration("Amina")).status).toBe("confirmed");

  await card.getByRole("button", { name: "Cancel Amina's registration" }).click();
  await expect(page.getByRole("heading", { name: "Cancel Amina's registration?" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Also take Amina off the .* roster/ })).toBeChecked();
  await page.getByRole("button", { name: "Cancel registration", exact: true }).click();

  await expect(card.getByText("cancelled", { exact: true })).toBeVisible();
  await expect(card.getByText("Enrolled")).toHaveCount(0);
  const reg = await registration("Amina");
  const { data: enrollment } = await admin.from("enrollments").select("status").eq("id", reg.enrollment_id).single();
  expect(enrollment!.status).toBe("withdrawn");
  const { count } = await admin.from("invoices").select("*", { count: "exact", head: true }).eq("program_id", programId);
  expect(count).toBe(0);

  await card.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Restored — Amina has a seat")).toBeVisible();
  await expect(card.getByText("Enrolled")).toBeVisible();
  expect((await registration("Amina")).status).toBe("confirmed");
});

test("the waitlist reads in line order, and the seat goes to the next in line", async ({ page }) => {
  const { programId } = await seedProgram({ capacity: 1 });
  for (const child of ["Seated", "First", "Second", "Third"]) await register(programId, child);
  await admin.from("registrations").update({ status: "cancelled" }).eq("id", (await registration("Seated")).id);

  await signIn(page);
  await page.goto("/registrations");
  await page.getByRole("button", { name: /^waitlisted/ }).click();

  const names = page.locator("span.font-medium", { hasText: /Tester$/ });
  await expect(names).toHaveText(["First Tester", "Second Tester", "Third Tester"]);

  // Skipping the family first in line is asked about, not done quietly.
  let asked = "";
  page.once("dialog", async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page
    .locator("div.rounded-xl", { hasText: "Second Tester" })
    .getByRole("button", { name: "Give a seat" })
    .click();
  await expect.poll(() => asked).toContain("First Tester is #1 in line");
  expect((await registration("Second")).status).toBe("waitlisted");

  await page.getByRole("button", { name: "Give a seat to next in line" }).click();
  await expect(page.getByText("First has a seat")).toBeVisible();
  expect((await registration("First")).status).toBe("confirmed");
  expect((await registration("Second")).waitlist_position).toBe(1);
});
