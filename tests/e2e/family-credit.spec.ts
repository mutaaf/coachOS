import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #28: a family who has already paid sends money ahead. It used to be
 * refused ("nothing to pay"), and their pay page asked them to send a month's
 * fee they didn't owe. Now it is kept as their credit, shown to her and to
 * them, and the next invoice is paid from it.
 */

function businessMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}

let savedRecipient: string | null = null;

test.beforeAll(async () => {
  await ensureTestUser();
  const { data } = await admin.from("config").select("value").eq("key", "zelle_recipient").maybeSingle();
  savedRecipient = data?.value ?? null;
  await admin.from("config").update({ value: "972-900-0292" }).eq("key", "zelle_recipient");
});

test.afterAll(async () => {
  await admin.from("config").update({ value: savedRecipient ?? "" }).eq("key", "zelle_recipient");
  await truncateAll();
});

test.beforeEach(truncateAll);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Raquel, with Mia on a $90 program, and this month already paid. */
async function paidUpFamily() {
  const { programId } = await seedProgram({ monthlyFee: 90 });
  const { data: p } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145550101" })
    .select("id, pay_token")
    .single();
  const { data: s } = await admin.from("students").insert({ first_name: "Mia", last_name: "Garcia" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  const month = businessMonth();
  const { data: inv } = await admin
    .from("invoices")
    .insert({ parent_id: p!.id, student_id: s!.id, program_id: programId, amount: 90, month, due_date: `${month}-01`, status: "paid" })
    .select("id")
    .single();
  await admin.from("payments").insert({ invoice_id: inv!.id, amount: 90, method: "cash" });
  return { parentId: p!.id as string, payToken: p!.pay_token as string };
}

test("money from a family who has already paid is kept as their credit", async ({ page }) => {
  await paidUpFamily();
  await signIn(page);
  await page.goto("/payments");

  const header = page.locator("h1", { hasText: "Payments" }).locator("..");
  await header.getByRole("button", { name: "Record Payment" }).click();
  const d = page.getByTestId("assign-payment");
  await d.getByLabel("Amount paid").fill("90");
  await d.getByRole("button", { name: /Raquel Garcia/ }).click();

  // Straight to the check: nothing to fill in about which child.
  await expect(d.getByTestId("assign-review")).toContainText("kept as credit");
  await d.getByRole("button", { name: "Record $90.00" }).click();
  await expect(page.getByText("$90.00 recorded for Raquel Garcia")).toBeVisible();

  const credits = page.getByTestId("family-credits");
  await expect(credits).toContainText("Raquel Garcia");
  await expect(credits).toContainText("$90.00");
});

test("a paid-up family's pay page shows their credit and doesn't ask for money", async ({ page }) => {
  const { parentId, payToken } = await paidUpFamily();
  await admin.from("family_credits").insert({ parent_id: parentId, amount: 90, method: "zelle" });

  await page.goto(`/pay/${payToken}`);
  await expect(page.getByText("You're all paid up")).toBeVisible();
  await expect(page.getByText("You have $90.00 in credit")).toBeVisible();
  await expect(page.getByText(/Send \$/)).toHaveCount(0);
  await expect(page.getByText(/Nothing is owed right now/)).toBeVisible();
});
