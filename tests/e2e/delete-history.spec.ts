import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Deleting a withdrawn child erased their paid invoice and its payment
 * (issue #11). Delete now refuses for anyone with payment history and offers
 * Archive, which takes the child off her list and keeps every record.
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

test("deleting a child with payment history offers Archive and keeps the payment", async ({ page }) => {
  const { programId } = await seedProgram();
  const { data: p } = await admin.from("parents").insert({ first_name: "Sara", last_name: "Yusuf", phone: "+12145550001" }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: "Theo", last_name: "Yusuf" }).select("id").single();
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "withdrawn" });
  const { data: inv } = await admin
    .from("invoices")
    .insert({ parent_id: p!.id, student_id: s!.id, program_id: programId, amount: 100, month: "2026-09", due_date: "2026-09-01", status: "paid" })
    .select("id")
    .single();
  await admin.from("payments").insert({ invoice_id: inv!.id, amount: 100, method: "cash" });

  await signIn(page);
  await page.goto("/students");

  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.getByRole("row", { name: /Theo Yusuf/ }).getByTitle("Delete student").click();

  await expect(page.getByText("Student archived")).toBeVisible();
  expect(dialogs[1]).toMatch(/payment history/);
  await expect(page.getByRole("row", { name: /Theo Yusuf/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Show archived (1)" }).click();
  await expect(page.getByRole("row", { name: /Theo Yusuf/ })).toContainText("archived");

  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", inv!.id);
  expect(count).toBe(1);
  const { data } = await admin.from("students").select("status").eq("id", s!.id).single();
  expect(data!.status).toBe("inactive");
});
