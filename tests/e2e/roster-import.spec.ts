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

test("importing the list again leaves a child she withdrew off, unless she ticks them", async ({ page }) => {
  const { data: school } = await admin.from("schools").insert({ name: "FCA", status: "active" }).select("id").single();
  const { data: program } = await admin
    .from("programs")
    .insert({ school_id: school!.id, name: "Lil Dribblers", monthly_fee: 100, status: "active", capacity: 12 })
    .select("id")
    .single();
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+19155002487" })
    .select("id")
    .single();
  const { data: kids } = await admin
    .from("students")
    .insert([
      { first_name: "Mia", last_name: "Garcia" },
      { first_name: "Leo", last_name: "Garcia" },
    ])
    .select("id, first_name");
  await admin.from("student_parents").insert(kids!.map((k) => ({ student_id: k.id, parent_id: parent!.id, relationship: "parent" })));
  const mia = kids!.find((k) => k.first_name === "Mia")!;
  const leo = kids!.find((k) => k.first_name === "Leo")!;
  await admin.from("enrollments").insert([
    { student_id: mia.id, program_id: program!.id, status: "withdrawn" },
    { student_id: leo.id, program_id: program!.id, status: "withdrawn" },
  ]);
  const status = async (id: string) =>
    (await admin.from("enrollments").select("status").eq("student_id", id).single()).data!.status;

  await signIn(page);
  await page.goto("/schools");
  await page.getByRole("button", { name: "Import a roster" }).first().click();
  await page.getByLabel("School", { exact: true }).selectOption({ label: "FCA" });
  await page.getByLabel("Session", { exact: true }).selectOption({ label: "Lil Dribblers ($100/mo)" });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Or paste it").fill(CSV.split("\n").slice(0, 3).join("\n"));
  await page.getByRole("button", { name: "Read roster" }).click();

  // Both are flagged, not a green tick, and neither counts towards the import.
  await expect(page.getByText("You withdrew this child from this session.", { exact: false })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Import 0 children" })).toBeDisabled();

  // She brings Leo back on purpose; Mia stays off.
  await page.getByTestId("roster-row").nth(1).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Import 1 child" }).click();

  await expect(page.getByText("1 child added to FCA · Lil Dribblers.")).toBeVisible();
  await expect(page.getByText("1 you withdrew was left off")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Mia Garcia$/ })).toBeVisible();
  expect(await status(mia.id)).toBe("withdrawn");
  expect(await status(leo.id)).toBe("active");
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
