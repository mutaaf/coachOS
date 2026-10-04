import { test, expect, type Page } from "@playwright/test";
import { admin, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * "Who paid this?" from the Payments page, the way she'll use it: on a phone,
 * for money from someone CoachOS has never heard of.
 */

test.beforeEach(truncateAll);
test.afterAll(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a Zelle from a brand-new family: new school, program, parent and child, in one go", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await admin.from("zelle_receipts").insert({
    message_id: "e2e-assign-new",
    sender_name: "RAQUEL M GARCIA",
    amount: 120,
    memo: "soccer mia",
    status: "unmatched",
  });

  await signIn(page);
  await page.goto("/payments");
  await page.getByRole("button", { name: "Who paid this?" }).click();
  const d = page.getByTestId("assign-payment");
  await expect(d.getByText("by Zelle from")).toBeVisible();

  await d.getByRole("button", { name: "Someone new" }).click();
  // The sender's name is filled in, tidied, without the middle initial.
  await expect(d.getByLabel("Parent first name")).toHaveValue("Raquel");
  await expect(d.getByLabel("Last name")).toHaveValue("Garcia");
  await d.getByLabel("Phone (for WhatsApp)").fill("214-555-0101");
  await d.getByRole("button", { name: "Next: their child" }).click();

  await d.getByLabel("Child first name").fill("Mia");
  await expect(d.getByLabel("Last name")).toHaveValue("Garcia");
  await d.getByRole("button", { name: "Next: school and session" }).click();

  await d.getByLabel("School").selectOption({ label: "+ A new school" });
  await d.getByLabel("New school’s name").fill("Lakehill Elementary");
  await d.getByLabel("New session’s name").fill("Fall Soccer");
  // The fee starts at what was paid.
  await expect(d.getByLabel("Monthly fee")).toHaveValue("120.00");
  await d.getByRole("button", { name: "Next: check it over" }).click();

  const review = d.getByTestId("assign-review");
  await expect(review).toContainText("New family: Raquel Garcia");
  await expect(review).toContainText("New school: Lakehill Elementary");
  await expect(review).toContainText("Fall Soccer, $120.00 a month");
  await expect(review).toContainText("Add Mia to Fall Soccer");
  await expect(review).toContainText("paid in full");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await d.getByRole("button", { name: "Record $120.00" }).click();
  await expect(page.getByText("$120.00 recorded for Raquel Garcia")).toBeVisible();

  const { data: inv } = await admin
    .from("invoices")
    .select("status, students(first_name), programs(name, schools(name))")
    .single();
  expect(inv).toEqual({
    status: "paid",
    students: { first_name: "Mia" },
    programs: { name: "Fall Soccer", schools: { name: "Lakehill Elementary" } },
  });
});

test("typing a number that's already on file offers that family instead of a duplicate", async ({ page }) => {
  const { programId } = await seedProgram({ monthlyFee: 80 });
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Ana", last_name: "Lopez", phone: "+12145550199" })
    .select("id")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: "Leo", last_name: "Lopez" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  // Someone else's open invoice, so invoice rows (with their own Record Payment) are on the page too.
  const { data: other } = await admin.from("parents").insert({ first_name: "Bo", last_name: "Kim", phone: "+12145550111" }).select("id").single();
  const { data: kid } = await admin.from("students").insert({ first_name: "Jun", last_name: "Kim" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: kid!.id, parent_id: other!.id });
  await admin.from("invoices").insert({ parent_id: other!.id, student_id: kid!.id, program_id: programId, amount: 80, month: "2099-01", due_date: "2099-01-01", status: "pending" });

  await signIn(page);
  await page.goto("/payments");
  // One button for money from anyone, in the page header — not a second one
  // beside it. (Invoice rows have their own, for paying that invoice.)
  const header = page.locator("h1", { hasText: "Payments" }).locator("..");
  await expect(header.getByRole("button", { name: /record (a )?payment/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^record a payment$/i })).toHaveCount(0);
  await header.getByRole("button", { name: "Record Payment" }).click();
  const d = page.getByTestId("assign-payment");
  await d.getByLabel("Amount paid").fill("80");
  await d.getByRole("button", { name: "Someone new" }).click();
  await d.getByLabel("Parent first name").fill("Anna");
  await d.getByLabel("Phone (for WhatsApp)").fill("(214) 555-0199");
  await expect(d.getByText("Ana Lopez’s number already")).toBeVisible();
  await expect(d.getByRole("button", { name: "Next: their child" })).toBeDisabled();
  await d.getByRole("button", { name: "Use Ana’s family" }).click();

  // Ana owes nothing yet, so: which child, and the program Leo is already in.
  await expect(d.getByRole("radio", { name: /Leo Lopez/ })).toBeChecked();
  await d.getByRole("button", { name: "Next: school and session" }).click();
  await d.getByRole("button", { name: "Next: check it over" }).click();
  await expect(d.getByTestId("assign-review")).toContainText("Leo in Test Program");
  await d.getByRole("button", { name: "Record $80.00" }).click();
  await expect(page.getByText("$80.00 recorded for Ana Lopez")).toBeVisible();

  // No second Ana.
  const { count } = await admin.from("parents").select("*", { count: "exact", head: true }).eq("phone", "+12145550199");
  expect(count).toBe(1);
  const { data: pay } = await admin.from("payments").select("amount, method").single();
  expect(pay).toEqual({ amount: 80, method: "cash" });
});
