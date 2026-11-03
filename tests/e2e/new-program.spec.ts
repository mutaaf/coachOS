import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { admin, adminPublic, anonPublic, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The owner's ask: "make it easy for me to create programs and assign to
 * schools" — and get real photos on the website without a deploy. Driven on a
 * phone, end to end, then checked the way the website reads it (anon key).
 */

const NAME = "Zz E2E Hoops";

test.beforeAll(ensureTestUser);
test.beforeEach(cleanUp);
test.afterAll(cleanUp);

async function cleanUp() {
  await adminPublic.from("programs").delete().like("title", "Zz E2E%");
  await truncateAll();
  const { data } = await admin.from("site_media").select("id, file_paths").like("original_filename", "zz-e2e%");
  for (const m of data ?? []) if ((m.file_paths as string[]).length) await admin.storage.from("site-media").remove(m.file_paths as string[]);
  await admin.from("site_media").delete().like("original_filename", "zz-e2e%");
  await admin.from("program_catalog").delete().like("name", "Zz E2E%");
  await admin.from("seasons").delete().like("name", "Zz E2E%");
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** A published photo in the library, its file really in the bucket. */
async function libraryPhoto(alt: string) {
  const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#e07a1f" } }).png().toBuffer();
  const path = `zz-e2e/${Date.now()}.png`;
  await admin.storage.from("site-media").upload(path, png, { contentType: "image/png" });
  const url = admin.storage.from("site-media").getPublicUrl(path).data.publicUrl;
  const { data, error } = await admin
    .from("site_media")
    .insert({ status: "ready", url, srcset: [], file_paths: [path], width: 640, height: 400, alt, published: true, original_filename: "zz-e2e.png" })
    .select("id, url")
    .single();
  if (error) throw error;
  return data as { id: string; url: string };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("main");
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

test("create a program at two schools, open for sign-ups, on the website with a photo — one save, on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { data: lakehill } = await admin.from("schools").insert({ name: "Zz E2E Lakehill", address: "1 Main St, Wylie TX", status: "active" }).select("id").single();
  const photo = await libraryPhoto("Kids dribbling past cones in a gym");

  await signIn(page);
  await page.goto("/programs");
  await page.getByTestId("new-program").click();
  await expect(page).toHaveURL(/\/programs\/new$/);

  // 1. The program.
  await page.getByLabel("Program name").fill(NAME);
  await page.getByRole("button", { name: "7-9 years" }).click();
  await page.getByLabel("Description for parents").fill("Dribbling, passing and teamwork.");
  await page.getByLabel("Usual monthly fee").fill("110");
  await noSidewaysScroll(page);
  await page.getByTestId("wizard-next").click();

  // 2. Schools, season, times.
  await page.getByLabel("Find a school").fill("lakeh");
  await page.getByRole("button", { name: "Add Zz E2E Lakehill" }).click();
  await page.getByRole("button", { name: "New school" }).click();
  await page.getByLabel("New school’s name").fill("Zz E2E Oak Prep");
  await page.getByLabel("Address").fill("2 Oak Ave, Plano TX");
  await page.getByRole("button", { name: "Add school", exact: true }).click();
  await expect(page.getByRole("list", { name: "Chosen schools" })).toContainText("Zz E2E Oak Prep");

  await page.getByLabel("Season", { exact: true }).selectOption({ label: "+ A new season" });
  await page.getByLabel("New season’s name").fill("Zz E2E Fall 2026");
  await page.getByLabel("Season starts").fill("2026-09-08");
  await page.getByLabel("Season ends").fill("2026-12-11");

  await page.getByRole("button", { name: "Add a weekly practice" }).click();
  await page.getByRole("button", { name: "Another practice" }).click(); // Tue, then Thu at the same time
  await page.getByLabel("Fee / mo at Zz E2E Oak Prep").fill("125");
  await page.getByLabel("Places at Zz E2E Oak Prep").fill("8");
  await noSidewaysScroll(page);
  await page.getByTestId("wizard-next").click();

  // 3. Sign-ups and website: both on by default; pick the photo.
  await expect(page.getByRole("switch", { name: "Open for sign-ups now" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "Show on the website" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Kids dribbling past cones in a gym" }).click();
  const preview = page.getByTestId("card-preview").last();
  await expect(preview).toContainText(NAME);
  await expect(preview).toContainText("Zz E2E Oak Prep");
  await expect(preview).toContainText("Tue 3:30–4:30 PM, Thu 3:30–4:30 PM · $125/month · 8 spots");
  await expect(page.getByTestId("review")).toContainText("put it on at 2 schools, open for sign-ups");
  await noSidewaysScroll(page);
  await page.getByRole("button", { name: "Save — 2 schools" }).click();

  const done = page.getByTestId("new-program-done");
  await expect(done).toContainText(`${NAME} is on at 2 schools`);
  await expect(done).toContainText("Zz E2E Oak Prep");

  // What the website reads, with the anon key.
  const { data: catalog } = await admin.from("program_catalog").select("id").eq("name", NAME).single();
  const { data: sessions } = await admin.from("programs").select("id").eq("catalog_id", catalog!.id);
  const { data: site } = await anonPublic
    .from("site_offerings")
    .select("title, image_url, venue_name, venue_address, monthly_fee, capacity, registration_open, schedule, season_name")
    .in("offering_id", sessions!.map((s) => s.id))
    .order("venue_name");
  expect(site).toEqual([
    {
      title: NAME, image_url: photo.url, venue_name: "Zz E2E Lakehill", venue_address: "1 Main St, Wylie TX", monthly_fee: 110, capacity: 12,
      registration_open: true, season_name: "Zz E2E Fall 2026",
      schedule: [{ dow: 2, start: "15:30", end: "16:30" }, { dow: 4, start: "15:30", end: "16:30" }],
    },
    {
      title: NAME, image_url: photo.url, venue_name: "Zz E2E Oak Prep", venue_address: "2 Oak Ave, Plano TX", monthly_fee: 125, capacity: 8,
      registration_open: true, season_name: "Zz E2E Fall 2026",
      schedule: [{ dow: 2, start: "15:30", end: "16:30" }, { dow: 4, start: "15:30", end: "16:30" }],
    },
  ]);
  void lakehill;

  // Back on Programs: both sessions; close sign-ups on both at once.
  await page.getByRole("link", { name: "Back to Programs" }).click();
  const card = page.getByTestId("program").filter({ hasText: NAME });
  await expect(card.getByTestId("session")).toHaveCount(2);
  await card.getByRole("checkbox", { name: "Select Zz E2E Lakehill" }).check();
  await card.getByRole("checkbox", { name: "Select Zz E2E Oak Prep" }).check();
  await page.getByTestId("bulk-signups").getByRole("button", { name: "Close sign-ups" }).click();
  await expect(page.getByText("Sign-ups closed for 2 sessions")).toBeVisible();
  await expect(card.getByText("Sign-ups closed")).toHaveCount(2);

  // Follow-ups start from what's there.
  await expect(card.getByRole("link", { name: "Add to another school" })).toHaveAttribute("href", `/programs/new?program=${catalog!.id}`);
  await card.getByRole("link", { name: /Duplicate Zz E2E Fall 2026 for next season/ }).click();
  await expect(page.getByRole("heading", { name: `${NAME} — next season` })).toBeVisible();
  await expect(page.getByLabel("New season’s name")).toHaveValue("");
  await expect(page.getByRole("list", { name: "Chosen schools" })).toContainText("Zz E2E Lakehill");
  await expect(page.getByLabel("Fee / mo at Zz E2E Oak Prep")).toHaveValue("125");
});

test("Photos: upload, describe, publish and put in the slideshow — the site sees it at once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/website?tab=photos");
  await expect(page.getByTestId("site-photos")).toContainText("Live on the website within a minute");

  const jpg = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#2a9d8f" } }).jpeg().toBuffer();
  await page.getByTestId("photo-input").setInputFiles({ name: "zz-e2e-practice.jpg", mimeType: "image/jpeg", buffer: jpg });

  // One photo: its dialog opens to describe it.
  const dialog = page.getByTestId("photo-dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByTestId("focal-picker").click({ position: { x: 20, y: 20 } });
  await dialog.getByLabel(/Description \(alt text\)/).fill("Coach showing a player how to shoot");
  await dialog.getByRole("checkbox", { name: /children who could be recognized/ }).check();
  // Can't go up without the release.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved (not on the website)")).toBeVisible();
  const { data: draft } = await admin.from("site_media").select("id, published, focal_x, srcset").eq("original_filename", "zz-e2e-practice.jpg").single();
  expect(draft!.published).toBe(false);
  expect(Number(draft!.focal_x)).toBeLessThan(0.2);
  expect((draft!.srcset as any[]).map((r) => r.w)).toEqual([480, 960, 1600]);

  await page.getByRole("button", { name: "Edit Coach showing a player how to shoot" }).click();
  await dialog.getByRole("checkbox", { name: /signed photo release is on file/ }).check();
  await dialog.getByRole("switch", { name: "On the website" }).click();
  await expect(dialog.getByRole("switch", { name: "On the website" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByLabel("Show it in").selectOption({ label: "Home page slideshow" });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved — live on the website within a minute")).toBeVisible();

  const { data: site } = await anonPublic.from("site_media").select("slot, alt, srcset").eq("slot", "hero");
  expect(site).toHaveLength(1);
  expect(site![0].alt).toBe("Coach showing a player how to shoot");
  await expect(page.getByTestId("slot-hero").getByTestId("slot-item")).toHaveCount(1);
  await noSidewaysScroll(page);
});
