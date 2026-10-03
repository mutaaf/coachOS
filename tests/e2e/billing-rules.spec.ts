import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #12, as the Boss sees it: a free program says it's free, a program
 * can't end before it starts, and archiving a school offers to end its
 * children's places. The billing rules themselves are in
 * tests/integration/billing-rules.test.ts.
 */

test.beforeAll(ensureTestUser);
test.afterEach(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a program with a $0 fee is saved and shown as free", async ({ page }) => {
  const { schoolId } = await seedProgram();
  await signIn(page);
  await page.goto(`/schools/${schoolId}`);

  await page.getByRole("button", { name: /add program|create first program/i }).first().click();
  await page.locator("#name").fill("Scholarship Squad");
  await page.locator("#monthly_fee").fill("0");
  await page.getByRole("button", { name: "Create Program", exact: true }).click();

  await expect(page.getByText("Free – no invoices")).toBeVisible();
  const { data } = await admin.from("programs").select("monthly_fee").eq("name", "Scholarship Squad").single();
  expect(Number(data!.monthly_fee)).toBe(0);
});

test("a program can't end before it starts", async ({ page }) => {
  const { schoolId } = await seedProgram();
  await signIn(page);
  await page.goto(`/schools/${schoolId}`);

  await page.getByRole("button", { name: /add program|create first program/i }).first().click();
  await page.locator("#name").fill("Backwards");
  await page.locator("#start_date").fill("2026-12-01");
  await page.locator("#end_date").fill("2026-09-01");
  await page.getByRole("button", { name: "Create Program", exact: true }).click();

  await expect(page.getByText("The end date is before the start date.")).toBeVisible();
  const { count } = await admin.from("programs").select("*", { count: "exact", head: true }).eq("name", "Backwards");
  expect(count).toBe(0);
});

test("archiving a school offers to end its children's places", async ({ page }) => {
  const { schoolId, programId } = await seedProgram();
  const { data: s } = await admin.from("students").insert({ first_name: "Amina", last_name: "Yusuf" }).select("id").single();
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });

  await signIn(page);
  await page.goto(`/schools/${schoolId}`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();

  const dialog = page;
  await expect(dialog.getByText(/not sent any more invoices/i)).toBeVisible();
  await expect(dialog.getByRole("switch", { name: /end the 1 child's place/i })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Archive school" }).click();

  await expect(page).toHaveURL(/\/schools$/);
  const { data: school } = await admin.from("schools").select("status").eq("id", schoolId).single();
  expect(school!.status).toBe("archived");
  const { data: enrollment } = await admin.from("enrollments").select("status").eq("program_id", programId).single();
  expect(enrollment!.status).toBe("completed");
});
