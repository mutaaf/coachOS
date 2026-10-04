import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #13: switching recipient mode in Compose kept the last group's parents
 * loaded, so a message for one school's families went to another school's.
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

async function family(programId: string, first: string, phone: string) {
  const { data: p } = await admin.from("parents").insert({ first_name: first, last_name: "Test", phone }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: `${first} Jr`, last_name: "Test" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
}

async function setUp(page: Page) {
  const lakehill = await seedProgram({});
  const oakwood = await seedProgram({});
  await admin.from("schools").update({ name: "Lakehill" }).eq("id", lakehill.schoolId);
  await admin.from("schools").update({ name: "Oakwood" }).eq("id", oakwood.schoolId);
  await family(lakehill.programId, "Lena", "+12145550201");
  await family(lakehill.programId, "Luis", "+12145550202");
  await family(oakwood.programId, "Omar", "+12145550301");

  await signIn(page);
  await page.goto("/messaging");
  await page.getByRole("tab", { name: "Compose", exact: true }).click();
  await page.getByPlaceholder("Type your message...").fill("Hi {{parent_name}}, practice moves to 5pm.");
  return { lakehill, oakwood };
}

const recipientsCard = (page: Page) => page.locator("div.rounded-2xl", { has: page.getByRole("heading", { name: "Recipients" }) });

test("By School → By Program sends only to the program picked", async ({ page }) => {
  const { oakwood } = await setUp(page);
  const card = recipientsCard(page);

  await page.getByRole("button", { name: "By School" }).click();
  await card.locator("select").selectOption({ label: "Lakehill" });
  await expect(card.getByText("Lena Test")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send to 2 recipient(s)" })).toBeEnabled();

  await page.getByRole("button", { name: "By Session" }).click();
  // Nothing picked yet: the placeholder shows, nobody is listed, and Send waits.
  await expect(card.locator("select")).toHaveValue("");
  await expect(card.getByText("Lena Test")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send to/ })).toBeDisabled();

  await card.locator("select").selectOption(oakwood.programId);
  await expect(card.getByText("Omar Test")).toBeVisible();
  await expect(card.getByText("Lena Test")).toHaveCount(0);
  await page.getByRole("button", { name: "Send to 1 recipient(s)" }).click();
  await expect(page.getByText(/1 message\(s\) ready in the Outbox/)).toBeVisible();

  const { data } = await admin.from("message_queue").select("recipient_name");
  expect(data!.map((m) => m.recipient_name)).toEqual(["Omar Test"]);
});

test("All Parents → By School sends to nobody until a school is picked", async ({ page }) => {
  await setUp(page);
  const card = recipientsCard(page);

  await page.getByRole("button", { name: "All Parents" }).click();
  await expect(page.getByRole("button", { name: "Send to 3 recipient(s)" })).toBeEnabled();

  await page.getByRole("button", { name: "By School" }).click();
  await expect(card.locator("select")).toHaveValue("");
  await expect(card.getByText("Lena Test")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send to/ })).toBeDisabled();

  await card.locator("select").selectOption({ label: "Oakwood" });
  await expect(page.getByRole("button", { name: "Send to 1 recipient(s)" })).toBeEnabled();
  await expect(card.getByText("Omar Test")).toBeVisible();
});
