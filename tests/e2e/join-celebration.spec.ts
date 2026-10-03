import { test, expect } from "@playwright/test";
import { admin, seedProgram, truncateAll } from "../helpers/db";

/** Signing up on a phone: a celebration, and the group chat only if there is one. */

test.beforeEach(truncateAll);
test.afterAll(truncateAll);

const GROUP = "https://chat.whatsapp.com/AbCdEf123456";

async function signUp(page: import("@playwright/test").Page, slug: string, email = "raquel@example.com") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/join/${slug}`);
  await page.locator("#child_first_name").fill("Mia");
  await page.locator("#child_last_name").fill("Garcia");
  await page.locator("#parent_first_name").fill("Raquel");
  await page.locator("#parent_last_name").fill("Garcia");
  await page.getByLabel("Mobile number").fill("(214) 555-0150");
  if (email) await page.locator("#parent_email").fill(email);
  await page.getByRole("button", { name: /register|sign up|join/i }).last().click();
}

test("a place: confetti, a bouncing ball, and the group chat", async ({ page }) => {
  const { programId, slug } = await seedProgram({ capacity: 5 });
  await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
  await signUp(page, slug);

  const done = page.getByTestId("registration-done");
  await expect(done.getByRole("heading", { name: "Mia is in! 🎉" })).toBeVisible();
  await expect(page.getByTestId("confetti")).toBeAttached();
  await expect(done.getByRole("link", { name: /Join the team group chat/ })).toHaveAttribute("href", GROUP);
  await expect(done).toContainText("We've emailed the details to raquel@example.com");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("no group: nobody is sent to WhatsApp", async ({ page }) => {
  const { slug } = await seedProgram({ capacity: 5 });
  await signUp(page, slug, "");
  const done = page.getByTestId("registration-done");
  await expect(done.getByRole("heading", { name: "Mia is in! 🎉" })).toBeVisible();
  await expect(done.getByText(/whatsapp|group chat/i)).toHaveCount(0);
  await expect(done).toContainText("We'll text you at (214) 555-0150");
});
