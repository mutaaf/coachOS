import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The amount she records is the amount that was paid (issue #9): not the last
 * invoice's, not twice, and not edited into money never received.
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

let phone = 0;
async function owes(child: string, amount: number, programId: string) {
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Parent", last_name: child, phone: `+1214555${String(++phone).padStart(4, "0")}` })
    .select("id")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: child, last_name: "Test" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  const { data: inv } = await admin
    .from("invoices")
    .insert({ parent_id: p!.id, student_id: s!.id, program_id: programId, amount, month: "2099-01", due_date: "2099-01-01", status: "pending" })
    .select("id")
    .single();
  return inv!.id as string;
}

test("Record Payment on a row starts at that invoice's amount, not the last one's", async ({ page }) => {
  const { programId } = await seedProgram();
  await owes("Mia", 60, programId);
  const theo = await owes("Theo", 120, programId);

  await signIn(page);
  await page.goto("/payments");
  const row = (name: string) => page.getByRole("row", { name: new RegExp(`${name} Test`) });

  await row("Mia").getByRole("button", { name: "Record Payment" }).click();
  const amount = page.getByLabel("Amount *");
  await expect(amount).toHaveValue(/^60(\.00)?$/);
  await page.getByRole("button", { name: "Cancel" }).click();

  await row("Theo").getByRole("button", { name: "Record Payment" }).click();
  await expect(amount).toHaveValue(/^120(\.00)?$/);
  await page.locator("form").getByRole("button", { name: "Record Payment" }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();

  const { data } = await admin.from("payments").select("invoice_id, amount");
  expect(data).toEqual([{ invoice_id: theo, amount: 120 }]);
});

test("a double tap on Record saves the payment once", async ({ page }) => {
  const { programId } = await seedProgram();
  await owes("Theo", 120, programId);

  await signIn(page);
  await page.goto("/payments");
  const header = page.locator("h1", { hasText: "Payments" }).locator("..");
  await header.getByRole("button", { name: "Record Payment" }).click();
  const d = page.getByTestId("assign-payment");
  await d.getByLabel("Amount paid").fill("40");
  await d.getByLabel("Search families").fill("Theo");
  await d.getByRole("button", { name: /Parent Theo/ }).click();
  await d.getByRole("button", { name: "Record $40.00" }).dblclick();
  await expect(page.getByText("$40.00 recorded for Parent Theo")).toBeVisible();

  await page.waitForTimeout(1000);
  const { data } = await admin.from("payments").select("amount");
  expect(data).toEqual([{ amount: 40 }]);
});

test("Edit Payment won't take more than the invoice leaves room for", async ({ page }) => {
  const { programId } = await seedProgram();
  const theo = await owes("Theo", 120, programId);
  await admin.from("payments").insert({ invoice_id: theo, amount: 40, method: "cash" });

  await signIn(page);
  await page.goto("/payments");
  await page.getByText("Payment History", { exact: true }).click();
  await page.getByRole("button", { name: "Edit payment" }).click();
  await page.getByLabel("Amount *").fill("500");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText(/more than the \$120\.00/)).toBeVisible();

  const { data } = await admin.from("payments").select("amount");
  expect(data).toEqual([{ amount: 40 }]);
});
