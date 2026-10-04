import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #40: Compose offered eleven {{variable}} chips but could fill only
 * {{parent_name}}, and "{{ parent_name }}" with spaces went to parents as raw
 * braces. She now sees only the chip that works, and what a parent will get.
 */

test.beforeAll(ensureTestUser);
test.beforeEach(truncateAll);
test.afterAll(truncateAll);

async function setUp(page: Page) {
  const { programId } = await seedProgram({});
  const { data: p } = await admin.from("parents").insert({ first_name: "Lena", last_name: "Ortiz", phone: "+12145550201" }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: "Mia", last_name: "Ortiz" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });

  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/messaging");
  await page.getByRole("tab", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "All Parents" }).click();
  await expect(page.getByRole("button", { name: "Send to 1 recipient(s)" })).toBeVisible();
}

test("Compose offers only {{parent_name}} and previews the message with it filled in", async ({ page }) => {
  await setUp(page);

  await expect(page.getByRole("button", { name: "{{parent_name}}" })).toBeVisible();
  await expect(page.getByRole("button", { name: "{{student_name}}" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "{{month}}" })).toHaveCount(0);

  await page.getByPlaceholder("Type your message...").fill("Hi {{ parent_name }}, practice moves to 5pm.");
  const preview = page.getByTestId("compose-preview");
  await expect(preview).toContainText("What Lena will get");
  await expect(preview).toContainText("Hi Lena, practice moves to 5pm.");

  await page.getByRole("button", { name: "Send to 1 recipient(s)" }).click();
  await expect(page.getByText(/1 message\(s\) ready in the Outbox/)).toBeVisible();
  const { data } = await admin.from("message_queue").select("message");
  expect(data!.map((m) => m.message)).toEqual(["Hi Lena, practice moves to 5pm."]);
});

test("a half-typed or unfillable variable is pointed out and can't be sent", async ({ page }) => {
  await setUp(page);
  const box = page.getByPlaceholder("Type your message...");
  const send = page.getByRole("button", { name: "Send to 1 recipient(s)" });

  await box.fill("Hi {{parent_name}, see you.");
  await expect(page.getByRole("alert").filter({ hasText: "still in {{ }} braces" })).toBeVisible();
  await expect(send).toBeDisabled();

  await box.fill("Hi, {{ student_name }} has practice.");
  await expect(page.getByRole("alert").filter({ hasText: "{{student_name}}" })).toBeVisible();
  await expect(send).toBeDisabled();

  await box.fill("Hi {{parent_name}}, see you.");
  await expect(send).toBeEnabled();
  expect((await admin.from("message_queue").select("id")).data).toEqual([]);
});
