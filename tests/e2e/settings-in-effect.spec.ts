import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #27: Settings said "in effect now" for values nothing read. What is
 * left there does what it says, and what can't work is refused.
 */

const KEYS = ["payment_due_day", "default_monthly_fee", "email_from", "stripe_enabled", "stripe_test_secret_key"];
let before: { key: string; value: string }[] = [];

test.beforeAll(async () => {
  await ensureTestUser();
  before = (await admin.from("config").select("key, value").in("key", KEYS)).data || [];
});
test.afterEach(async () => {
  for (const r of before) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  await truncateAll();
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a due day no month has is refused, not saved", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /Payments/ }).click();
  await page.getByLabel("Payment Due Day").fill("45");
  await page.getByRole("button", { name: /Save/ }).first().click();
  await expect(page.getByText("Settings weren't saved")).toBeVisible();
  await expect(page.getByText(/pick a day from 1 to 28/)).toBeVisible();
  const { data } = await admin.from("config").select("value").eq("key", "payment_due_day").single();
  expect(data!.value).toBe(before.find((r) => r.key === "payment_due_day")!.value);
});

test("a sender that can't send email is refused, not saved", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /Messaging/ }).click();
  await page.getByLabel("Send Email As").fill("garbage");
  await page.getByRole("button", { name: /Save/ }).first().click();
  await expect(page.getByText("Settings weren't saved")).toBeVisible();
  await expect(page.getByText(/a name and then an address at risingstars\.training/)).toBeVisible();
});

test("the default monthly fee is filled in for a new program", async ({ page }) => {
  await admin.from("config").update({ value: "85" }).eq("key", "default_monthly_fee");
  const { data: school } = await admin.from("schools").insert({ name: "Al-Noor Academy", status: "active" }).select("id").single();

  await signIn(page);
  await page.goto(`/schools/${school!.id}`);
  await page.getByRole("button", { name: /add session|add first session/i }).first().click();
  await expect(page.locator("#monthly_fee")).toHaveValue("85");
});

test("a family's payment page names the due day from Settings", async ({ page }) => {
  await admin.from("config").update({ value: "15" }).eq("key", "payment_due_day");
  // A fake key renders the page; nothing calls Stripe until a parent taps through.
  await admin.from("config").update({ value: "true" }).eq("key", "stripe_enabled");
  await admin.from("config").update({ value: "sk_test_render_only" }).eq("key", "stripe_test_secret_key");
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+19155002487" })
    .select("pay_token")
    .single();

  await page.goto(`/pay/${parent!.pay_token}`);
  await expect(page.getByText(/each month's fee is paid on its due date \(the 15th\)/)).toBeVisible();
});

test("settings nothing used are no longer shown", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: /Payments/ })).toBeVisible();
  for (const label of ["Coach Phone", "Coach Name", "Message Rate Limit (seconds)", "Morning Reminder Time"]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /Scheduling/ })).toHaveCount(0);
});
