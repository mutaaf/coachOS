import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The owner's first ten minutes: an empty dashboard, a session's list in a
 * spreadsheet, and the families on the roster at the end of it.
 *
 * Driven with a CSV because that path runs without a model. Reading
 * screenshots goes through the same review screen; what the reader sends and
 * returns is covered in tests/integration/roster.test.ts.
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

const CSV = [
  "Child Name,Parent Name,Phone",
  "Mia Garcia,Raquel Garcia,(915) 500-2487",
  "Leo Garcia,Raquel Garcia,915.500.2487",
  "Ada Okafor,Star Okafor,",
].join("\n");

test("from an empty dashboard to a session's roster, from a spreadsheet", async ({ page }) => {
  await signIn(page);
  await page.goto("/schools");

  await page.getByRole("button", { name: "Import a roster" }).first().click();
  await page.getByLabel("New school name").fill("FCA");
  await page.getByLabel("New session name").fill("Lil Dribblers");
  await page.getByLabel("Monthly fee").fill("100");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByTestId("roster-files").setInputFiles({
    name: "dribblers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  await expect(page.getByText("dribblers.csv")).toBeVisible();
  await page.getByRole("button", { name: "Read roster" }).click();

  // Three children found; one has no phone and is held back until fixed.
  await expect(page.getByTestId("roster-row")).toHaveCount(3);
  await expect(page.getByText("1 needs a fix")).toBeVisible();
  await expect(page.getByText("Parent's phone number is missing or incomplete")).toBeVisible();

  await page.getByLabel("Parent phone, row 3").fill("972-891-8266");
  await page.getByLabel("Parent phone, row 3").blur();
  await expect(page.getByRole("button", { name: "Import 3 children" })).toBeEnabled();
  await page.getByRole("button", { name: "Import 3 children" }).click();

  await expect(page.getByText("3 children added to FCA · Lil Dribblers.")).toBeVisible();
  await expect(page.getByText("2 new families")).toBeVisible();

  // Two families, not three: the Garcias' number was typed two ways.
  const { data: parents } = await admin.from("parents").select("phone").order("phone");
  expect(parents).toEqual([{ phone: "+19155002487" }, { phone: "+19728918266" }]);
  const { count } = await admin.from("enrollments").select("id", { count: "exact", head: true });
  expect(count).toBe(3);
  const { data: program } = await admin.from("programs").select("name, monthly_fee, schools(name)").single();
  expect(program).toMatchObject({ name: "Lil Dribblers", monthly_fee: 100, schools: { name: "FCA" } });
});

test("a screenshot needs the reader switched on, and says so plainly", async ({ page }) => {
  // The test server runs without an Anthropic key, as production does until one is added.
  await signIn(page);
  await page.goto("/schools");
  await page.getByRole("button", { name: "Import a roster" }).first().click();
  await page.getByLabel("New school name").fill("FCA");
  await page.getByLabel("New session name").fill("Lil Dribblers");
  await page.getByRole("button", { name: "Next" }).click();

  // A 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  await page.getByTestId("roster-files").setInputFiles({ name: "group.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Read roster" }).click();

  await expect(page.getByText(/Reading screenshots isn.t switched on yet/)).toBeVisible();
});
