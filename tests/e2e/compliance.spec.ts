import { test, expect, type Page } from "@playwright/test";
import { admin, anonPublic, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * What the owner sees: a coach who isn't cleared is flagged on Coaches, a
 * child without a photo release is flagged on the family page with their
 * consents, and the Compliance page lists a privacy request with its deadline.
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

test("a scheduled coach who isn't cleared is flagged", async ({ page }) => {
  const { programId } = await seedProgram();
  const { data: coach } = await admin
    .from("coaches")
    .insert({ first_name: "Uncleared", last_name: "Coach", phone: "+12145550111", status: "active" })
    .select("id")
    .single();
  await admin.from("schedule_templates").insert({ program_id: programId, day_of_week: 2, start_time: "16:00", end_time: "17:00", coach_id: coach!.id });

  await signIn(page);
  await page.goto("/coaches");
  await expect(page.getByTestId("coaches-not-cleared")).toBeVisible();
  // Other specs leave cleared coaches behind, so don't rely on list order.
  await expect(page.getByText("Uncleared Coach").first()).toBeVisible();
  await expect(page.getByTestId("coach-clearance").filter({ hasText: /Not cleared/ }).first()).toBeVisible();
  await expect(page.getByText(/Scheduled to coach but not cleared/)).toBeVisible();
});

test("the family page shows consents and who can't be photographed", async ({ page }) => {
  const now = new Date().toISOString();
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Hina", last_name: "Khan", phone: "+12145550112", sms_consent_at: now, sms_promotional_consent_at: now })
    .select("id")
    .single();
  const { data: child } = await admin.from("students").insert({ first_name: "Zara", last_name: "Khan" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id });

  await signIn(page);
  await page.goto(`/students/family/${parent!.id}`);
  await expect(page.getByTestId("family-consents")).toBeVisible();
  await expect(page.getByTestId("no-photo-release")).toBeVisible();
  await expect(page.getByTestId("consent-sms-promotional")).toHaveText(/Promotional texts:\s*Agreed/);
  await page.getByRole("button", { name: "They said STOP" }).click();
  await expect(page.getByTestId("consent-sms")).toHaveText(/Said STOP/);
  // A STOP covers promotions too.
  await expect(page.getByTestId("consent-sms-promotional")).toHaveText(/No promotions/);
});

test("Compose explains who a promotion leaves out", async ({ page }) => {
  await signIn(page);
  await page.goto("/messaging?tab=compose");
  await expect(page.getByTestId("compose-promotional-help")).toContainText("hasn't agreed to promotional texts");
});

test("a privacy request shows its legal deadline", async ({ page }) => {
  await anonPublic.rpc("submit_inquiry", {
    p_kind: "privacy_request",
    p_contact: { first_name: "Maya", email: "maya@example.com" },
    p_details: { request_type: "access" },
    p_attribution: null,
  });
  await signIn(page);
  await page.goto("/compliance?tab=privacy");
  await expect(page.getByTestId("privacy-request")).toContainText("See their data");
  await expect(page.getByTestId("privacy-deadline")).toContainText(/4[45] days left/);
});
