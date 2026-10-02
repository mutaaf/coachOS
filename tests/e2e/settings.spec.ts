import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, TEST_USER } from "../helpers/db";

/**
 * Every address and key is a setting an admin can change, copy, and use
 * without retyping — and a change shows up across the app with no deploy.
 */

const KEYS = ["zelle_alerts_inbox", "zelle_alerts_forward_from", "business_name"];
let before: { key: string; value: string }[] = [];

test.beforeAll(async () => {
  await ensureTestUser();
  before = (await admin.from("config").select("key, value").in("key", KEYS)).data || [];
});
test.afterAll(async () => {
  for (const r of before) await admin.from("config").update({ value: r.value }).eq("key", r.key);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("keys are hidden until asked for, and copy without being shown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /Payments/ }).click();

  const key = page.locator("#cfg-zelle_inbound_secret");
  await expect(key).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show Zelle Email Key" }).click();
  await expect(key).toHaveAttribute("type", "text");

  const value = await key.inputValue();
  await key.locator("xpath=..").getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
});

test("an address changed in Settings is used everywhere at once, no deploy", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /Payments/ }).click();

  await page.getByLabel("Zelle Alerts Gmail").fill("owner.zelle@example.test");
  await page.getByLabel("Bank Alerts Arrive At").fill("owner.bank@example.test");
  await page.getByRole("button", { name: /Save/ }).first().click();
  await expect(page.getByText("Saved — in effect now")).toBeVisible();

  // The setup steps pick it up, with buttons to open and copy rather than type.
  await expect(page.getByText("1. Open Gmail as owner.zelle@example.test")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Gmail" })).toHaveAttribute(
    "href",
    /authuser=owner\.zelle%40example\.test/
  );
  await expect(page.getByRole("link", { name: "Open Apps Script" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy the script" })).toBeVisible();
  await expect(page.getByText(/forward Zelle alerts from owner\.bank@example\.test/)).toBeVisible();

  // So does the getting-started list.
  await page.goto("/dashboard");
  await expect(
    page.getByText(/forward Zelle alerts from owner\.bank@example\.test to owner\.zelle@example\.test/)
  ).toBeVisible();
});

test("an address that isn't one is refused, not saved", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /Payments/ }).click();
  await page.getByLabel("Zelle Alerts Gmail").fill("owner-at-gmail");
  await page.getByRole("button", { name: /Save/ }).first().click();
  await expect(page.getByText("Settings weren't saved")).toBeVisible();
  await expect(page.getByText(/isn't an email address/)).toBeVisible();
});

test("the WhatsApp bot is gone from Settings", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "WhatsApp" })).toHaveCount(0);
  const res = await page.request.post("/api/bot-health", { data: { url: "http://example.com" } });
  expect(res.status()).toBe(404);
});
