import { test, expect, type Page } from "@playwright/test";
import {
  admin,
  anonPublic,
  COMPLIANCE_USER,
  ensureComplianceUser,
  ensureTestUser,
  resetAuditCompliance,
  TEST_USER,
} from "../helpers/db";

/**
 * The owner's ask: his wife or an assistant fills in the policy facts after
 * researching them, and he publishes them to the website.
 *
 * The assistant signs in with the compliance role, edits a fact and sends it
 * for review; the owner publishes; the website's view returns the new value
 * and the document it appears on has a new version.
 */

test.beforeAll(async () => {
  await ensureTestUser();
  await ensureComplianceUser();
  resetAuditCompliance();
});
test.afterAll(() => resetAuditCompliance());

async function signIn(page: Page, user: { email: string; password: string }, lands: RegExp) {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(lands);
}

test("an assistant researches a fact, the owner publishes it, the website gets it with a new document version", async ({ page, browser }) => {
  const before = await anonPublic.from("site_legal_documents").select("document, version").eq("document", "registration_terms").single();

  // --- The assistant: Audit & Compliance only.
  await signIn(page, COMPLIANCE_USER, /\/compliance/);
  await expect(page.getByRole("heading", { name: "Audit & Compliance" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Privacy requests" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Incidents" })).toHaveCount(0);
  await expect(page.getByTestId("facts-progress")).toContainText("10 of 33 verified");

  // Families' pages send her back.
  await page.goto("/students");
  await expect(page).toHaveURL(/\/compliance$/);
  await page.goto("/payments");
  await expect(page).toHaveURL(/\/compliance$/);

  await page.getByTestId("fact-lateFee").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("What to research")).toBeVisible();
  await drawer.getByLabel("Value").fill("none. If an invoice is more than 21 days overdue, your child’s spot may be released to the waitlist.");
  await expect(drawer.getByTestId("fact-preview")).toContainText("Late fee: none. If an invoice is more than 21 days overdue");
  await expect(drawer.getByTestId("fact-diff").locator("ins")).toContainText("21");
  await expect(drawer.getByTestId("fact-diff").locator("del")).toContainText("14");
  await drawer.getByLabel("Research notes").fill("Checked Settings → overdue rules: 21 days.");
  await drawer.getByLabel("Source links").fill("https://risingstars.training/registration-terms");
  // No publish button for the compliance role.
  await expect(drawer.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Sent for review")).toBeVisible();
  await expect(page.getByTestId("fact-lateFee").getByTestId("fact-status")).toHaveText("In review");
  await expect(page.getByTestId("publish-bar")).toContainText("An admin publishes these");
  await expect(page.getByTestId("publish-bar")).toContainText("Registration Terms");

  // Nothing on the website yet.
  const draftView = await anonPublic.from("site_legal_facts").select("value").eq("key", "lateFee").single();
  expect(draftView.data?.value).toMatch(/14 days/);

  // The checklist: she marks the Texas No-Call check done; the due date rolls.
  await page.getByRole("tab", { name: "Checklist" }).click();
  const task = page.getByTestId("task-texas-no-call");
  await task.getByRole("button", { name: "Mark done" }).click();
  await page.getByRole("dialog").getByLabel("Notes").fill("Q4 list downloaded; promotions only to opted-in parents");
  await page.getByRole("dialog").getByLabel("Evidence link").fill("https://drive.example.com/no-call-q4");
  await page.getByRole("dialog").getByRole("button", { name: "Mark done" }).click();
  await expect(task.getByTestId("task-last-done")).toContainText("Q4 list downloaded");

  // --- The owner publishes, in a fresh session.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, TEST_USER, /\/dashboard/);
  await owner.goto("/compliance");
  await expect(owner.getByRole("tab", { name: "Privacy requests" })).toBeVisible();
  const bar = owner.getByTestId("publish-bar");
  await expect(bar).toContainText("1 change waiting to be published");
  await bar.getByRole("button", { name: "Publish changes" }).click();
  await expect(owner.getByRole("dialog").getByTestId("fact-diff")).toContainText("21");
  await owner.getByTestId("confirm-publish").click();
  await expect(owner.getByText("Published 1 fact")).toBeVisible();
  await expect(owner.getByTestId("fact-lateFee").getByTestId("fact-status")).toHaveText("Verified");
  await expect(owner.getByTestId("facts-progress")).toContainText("11 of 33 verified");

  // --- The website's view of it.
  const published = await anonPublic.from("site_legal_facts").select("value, published_at").eq("key", "lateFee").single();
  expect(published.data?.value).toMatch(/21 days overdue/);
  const after = await anonPublic.from("site_legal_documents").select("document, version, effective_date").eq("document", "registration_terms").single();
  expect(after.data?.version).not.toBe(before.data?.version);
  expect(after.data?.version).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  const { data: minted } = await admin.from("legal_document_versions").select("fact_keys, published_by").eq("document", "registration_terms").eq("version", after.data!.version).single();
  expect(minted).toEqual({ fact_keys: ["lateFee"], published_by: `admin:${TEST_USER.email}` });

  // --- The audit log tells the story, filterable.
  await owner.goto("/compliance?tab=audit&kind=facts");
  const entries = owner.getByTestId("audit-entry");
  await expect(entries.filter({ hasText: "published" }).filter({ hasText: "Late payment fee" }).first()).toBeVisible();
  await expect(entries.filter({ hasText: "sent for review" }).filter({ hasText: COMPLIANCE_USER.email }).first()).toBeVisible();
  await expect(entries.filter({ hasText: "marked done" })).toHaveCount(0);
  await owner.goto("/compliance?tab=audit&kind=checklist");
  await expect(owner.getByTestId("audit-entry").filter({ hasText: "marked done" }).first()).toBeVisible();
  await ownerContext.close();
});

test("Settings lets the owner invite someone for Audit & Compliance only", async ({ page }) => {
  await signIn(page, TEST_USER, /\/dashboard/);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Access" }).click();
  const card = page.getByTestId("access-card");
  await expect(card.getByLabel("They can see")).toBeVisible();
  await expect(card.getByTestId("access-person").filter({ hasText: COMPLIANCE_USER.email }).getByTestId("access-role")).toHaveText("Compliance only");
});
