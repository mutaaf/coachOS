import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Getting paid without the monthly group message.
 *
 * The parent's side: open the link from WhatsApp with no account, see what is
 * owed, tell us whose Zelle account the money comes from, and turn autopay
 * off as easily as on. The owner's side: a Zelle payment the app could not
 * place lands in the inbox, and one tap records it against the right family.
 *
 * Stripe's own pages are not driven here — they are Stripe's, and need a real
 * account. What the app does with Stripe's answers is covered in
 * tests/integration/autopay.test.ts.
 */

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const SETTINGS = ["stripe_enabled", "stripe_test_secret_key", "zelle_recipient"];
let savedSettings: { key: string; value: string }[] = [];

test.beforeAll(async () => {
  await ensureTestUser();
  const { data } = await admin.from("config").select("key, value").in("key", SETTINGS);
  savedSettings = data || [];
  // A fake key renders the page; nothing calls Stripe until a parent taps through.
  await admin.from("config").update({ value: "true" }).eq("key", "stripe_enabled");
  await admin.from("config").update({ value: "sk_test_render_only" }).eq("key", "stripe_test_secret_key");
  await admin.from("config").update({ value: "972-900-0292, anum@example.test" }).eq("key", "zelle_recipient");
});

test.afterAll(async () => {
  for (const row of savedSettings) {
    await admin.from("config").update({ value: row.value }).eq("key", row.key);
  }
  await truncateAll();
});

test.beforeEach(truncateAll);

async function family(opts: { autopay?: boolean } = {}) {
  const { programId } = await seedProgram({ monthlyFee: 100 });
  const { data: parent } = await admin
    .from("parents")
    .insert({
      first_name: "Raquel",
      last_name: "Garcia",
      phone: "+19155002487",
      ...(opts.autopay
        ? {
            autopay_status: "active",
            autopay_method: "us_bank_account",
            autopay_payment_method_id: "pm_e2e",
            autopay_label: "Chase ••••6789",
            autopay_enabled_at: new Date().toISOString(),
          }
        : {}),
    })
    .select("id, pay_token")
    .single();
  const { data: student } = await admin
    .from("students")
    .insert({ first_name: "Mia", last_name: "Garcia" })
    .select("id")
    .single();
  await admin.from("student_parents").insert({ student_id: student!.id, parent_id: parent!.id });
  await admin.from("enrollments").insert({ student_id: student!.id, program_id: programId, status: "active" });
  const { data: invoice } = await admin
    .from("invoices")
    .insert({
      parent_id: parent!.id,
      student_id: student!.id,
      program_id: programId,
      amount: 100,
      month: today().slice(0, 7),
      due_date: `${today().slice(0, 7)}-01`,
      status: "pending",
    })
    .select("id")
    .single();
  return { parentId: parent!.id as string, token: parent!.pay_token as string, invoiceId: invoice!.id as string };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a parent opens their link, signed out, and sees what is owed and how to pay", async ({ page }) => {
  const { token } = await family();

  await page.goto(`/pay/${token}`);

  await expect(page).toHaveURL(new RegExp(`/pay/${token}`));
  await expect(page.getByRole("heading", { name: "Hi Raquel" })).toBeVisible();
  await expect(page.getByText("Payments for Mia.")).toBeVisible();
  await expect(page.getByText("$100.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /bank account.*no fee/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /card.*3% card fee/i })).toBeVisible();
  // Both places she accepts Zelle, each copyable on its own.
  await expect(page.getByRole("button", { name: /972-900-0292.*Copy/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /anum@example\.test.*Copy/ })).toBeVisible();
});

test("a parent can say whose Zelle account the money comes from", async ({ page }) => {
  const { token, parentId } = await family();

  await page.goto(`/pay/${token}`);
  const zelleName = page.getByLabel(/someone else.s name/i);
  await zelleName.fill("Miguel Garcia");
  await page.locator("form", { has: zelleName }).getByRole("button", { name: /^save$/i }).click();

  await expect(page.getByText("Saved — thank you.")).toBeVisible();
  // Shown as first name and initial: the link travels, the full name shouldn't.
  await expect(page.getByText(/We.ll recognise: Miguel G\./)).toBeVisible();
  await expect(page.getByText("Miguel Garcia")).toHaveCount(0);
  const { data } = await admin.from("zelle_senders").select("parent_id").eq("sender_key", "miguel garcia");
  expect(data).toEqual([{ parent_id: parentId }]);
});

test("autopay can be turned off from the same page, in two taps", async ({ page }) => {
  const { token, parentId } = await family({ autopay: true });

  await page.goto(`/pay/${token}`);
  await expect(page.getByText("Autopay is on")).toBeVisible();
  await expect(page.getByText(/Chase ••••6789/)).toBeVisible();

  await page.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("button", { name: /yes, turn off autopay/i }).click();

  await expect(page.getByText("Pay automatically")).toBeVisible();
  const { data } = await admin.from("parents").select("autopay_status").eq("id", parentId).single();
  expect(data!.autopay_status).toBe("off");
});

test("a parent can leave an email for receipts, and the page never shows it in full", async ({ page }) => {
  const { token, parentId } = await family();

  await page.goto(`/pay/${token}`);
  const field = page.getByLabel("Receipts by email");
  await field.fill("Raquel.Garcia@Example.com");
  await page.locator("form", { has: field }).getByRole("button", { name: /^save$/i }).click();

  await expect(page.getByText("Saved — receipts will go there.")).toBeVisible();
  await expect(page.getByText(/We send a receipt to r•••@example\.com/)).toBeVisible();
  await expect(page.getByText("raquel.garcia@example.com")).toHaveCount(0);
  const { data } = await admin.from("parents").select("email").eq("id", parentId).single();
  expect(data!.email).toBe("raquel.garcia@example.com");
});

test("a link that doesn't belong to anyone shows nothing", async ({ page }) => {
  const response = await page.goto("/pay/AAAAAAAAAAAAAAAAAAAAAAAA");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Raquel")).toHaveCount(0);
});

test("the owner records a Zelle payment the app couldn't place on its own", async ({ page }) => {
  const { invoiceId } = await family();
  await admin.from("zelle_receipts").insert({
    message_id: "e2e-unmatched",
    sender_name: "Miguel Garcia",
    amount: 100,
    status: "unmatched",
    note: "No parent on file is called Miguel Garcia — it may be a spouse or another account.",
  });

  await signIn(page);
  await page.goto("/payments");
  await expect(page.getByText("1 to check")).toBeVisible();

  await page.getByLabel("Family for Miguel Garcia").selectOption({ label: "Raquel Garcia (Mia)" });
  await page.getByRole("button", { name: "Record", exact: true }).click();

  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.getByText("Nothing to check.")).toBeVisible();
  const { data } = await admin.from("invoices").select("status").eq("id", invoiceId).single();
  expect(data!.status).toBe("paid");
});
