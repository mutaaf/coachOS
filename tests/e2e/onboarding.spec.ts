import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, resetTour, truncateAll, userMetadata, TEST_USER } from "../helpers/db";

/**
 * The owner's first login: a tour that walks every page, and a checklist that
 * ticks itself off from what has really happened.
 *
 * Run at desktop and phone widths, because she will mostly use a phone — where
 * the explanation has to sit clear of the thing it is explaining.
 */

test.beforeEach(truncateAll);
test.afterAll(async () => {
  await ensureTestUser();
  await truncateAll();
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

const STOPS: { title: RegExp; url: RegExp; spotlight: boolean }[] = [
  { title: /Welcome to CoachOS/, url: /\/dashboard/, spotlight: false },
  { title: /Your getting-started list/, url: /\/dashboard/, spotlight: true },
  { title: /Today at a glance/, url: /\/dashboard/, spotlight: true },
  { title: /Start here: import a roster/, url: /\/schools/, spotlight: true },
  { title: /Schools and sessions/, url: /\/schools/, spotlight: true },
  { title: /Students and parents/, url: /\/students/, spotlight: true },
  { title: /Registrations/, url: /\/registrations/, spotlight: true },
  { title: /Schedule and attendance/, url: /\/schedule/, spotlight: true },
  { title: /^Autopay$/, url: /\/payments/, spotlight: true },
  { title: /Zelle, recorded for you/, url: /\/payments/, spotlight: true },
  { title: /Invoices and what each status means/, url: /\/payments/, spotlight: true },
  { title: /Monthly invoices make themselves/, url: /\/payments/, spotlight: true },
  { title: /The Outbox/, url: /\/messaging\?tab=outbox/, spotlight: true },
  { title: /Compose, templates and history/, url: /\/messaging/, spotlight: true },
  { title: /^Settings$/, url: /\/settings/, spotlight: true },
  { title: /Your routine from here/, url: /\/dashboard/, spotlight: false },
];

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`the first login walks every page, then never starts again (${viewport.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const userId = await resetTour();
    await signIn(page);

    const dialog = page.getByRole("dialog");
    for (const [i, stop] of STOPS.entries()) {
      await expect(dialog.getByRole("heading", { name: stop.title })).toBeVisible();
      await expect(dialog.getByText(`${i + 1} of ${STOPS.length}`)).toBeVisible();
      await expect(page).toHaveURL(stop.url);

      if (stop.spotlight) {
        const spot = page.getByTestId("tour-spotlight");
        await expect(spot).toBeVisible();
        // The explanation never covers what it explains.
        const s = (await spot.boundingBox())!;
        const card = (await dialog.locator(".shadow-2xl").boundingBox())!;
        const overlapX = Math.min(s.x + s.width, card.x + card.width) - Math.max(s.x, card.x);
        const overlapY = Math.min(s.y + s.height, card.y + card.height) - Math.max(s.y, card.y);
        expect(
          overlapX > 0 && overlapY > Math.min(24, s.height / 2),
          `step ${i + 1} card covers its spotlight`
        ).toBe(false);
        // And the card is fully on screen.
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
        expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
      }

      await dialog.getByRole("button", { name: i === STOPS.length - 1 ? "Done" : "Next" }).click();
    }

    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await userMetadata(userId)).tour_completed_at).toBeTruthy();

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("skipping counts as done, and the menu brings the tour back", async ({ page }) => {
  const userId = await resetTour();
  await signIn(page);

  await page.getByRole("dialog").getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await userMetadata(userId)).tour_completed_at).toBeTruthy();

  await page.getByRole("button", { name: "Take the tour" }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /Welcome to CoachOS/ })).toBeVisible();
});

test("the checklist ticks itself off from what has really happened", async ({ page }) => {
  await ensureTestUser();
  const keys = ["zelle_recipient", "email_reply_to", "zelle_alerts_inbox"];
  const { data: before } = await admin.from("config").select("key, value").in("key", keys);
  await admin.from("config").update({ value: "" }).eq("key", "zelle_recipient");
  await admin.from("config").update({ value: "" }).eq("key", "email_reply_to");
  await admin.from("config").update({ value: "" }).eq("key", "zelle_alerts_inbox");
  try {
    await signIn(page);
    const items = page.getByTestId("onboarding-item");
    await expect(items).toHaveCount(6);
    // The test user has taken the tour; nothing else has happened.
    await expect(page.getByText("1 of 6 done")).toBeVisible();

    // "Show me" lands on the right part of the tour.
    await items.filter({ hasText: "Connect Zelle emails" }).getByRole("button", { name: "Show me" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Zelle, recorded for you/ })).toBeVisible();
    await expect(page).toHaveURL(/\/payments/);
    await page.keyboard.press("Escape");

    await admin.from("config").update({ value: "972-900-0292" }).eq("key", "zelle_recipient");
    await admin.from("config").update({ value: "owner@example.test" }).eq("key", "email_reply_to");
    await admin.from("config").update({ value: "owner.zelle@example.test" }).eq("key", "zelle_alerts_inbox");
    await page.goto("/dashboard");
    await expect(page.getByText("2 of 6 done")).toBeVisible();
  } finally {
    for (const r of before || []) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  }
});
