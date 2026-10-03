import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, register, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The same child is not added twice (issue #15). Add Student asks "Is this
 * the same Mia?", a registration added to the roster finds the family already
 * on file and puts the allergy note on the child the coach sees, and a double
 * tap on Add Lead makes one lead.
 */

async function clearLeads() {
  await admin.from("lead_activities").delete().not("id", "is", null);
  await admin.from("leads").delete().not("id", "is", null);
}

test.beforeAll(ensureTestUser);
test.beforeEach(async () => {
  await clearLeads();
  await truncateAll();
});
test.afterAll(async () => {
  await clearLeads();
  await truncateAll();
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function seedMia() {
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "(915) 500-2487" })
    .select("id")
    .single();
  const { data: child } = await admin
    .from("students")
    .insert({ first_name: "Mia", last_name: "Garcia", grade: "K" })
    .select("id")
    .single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id, relationship: "parent" });
  return child!.id as string;
}

test("Add Student asks 'Is this the same Mia?' and puts the note on the child on file", async ({ page }) => {
  const miaId = await seedMia();

  await signIn(page);
  await page.goto("/students");
  await page.getByRole("button", { name: "Add Student" }).first().click();
  await page.getByLabel("First Name").fill("Mía");
  await page.getByLabel("Last Name").fill("Garcia");
  await page.getByLabel("Medical Notes").fill("Peanut allergy — EpiPen");
  await page.getByRole("button", { name: "Add Student" }).last().click();

  const prompt = page.getByRole("group", { name: "Is this the same Mía?" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("Parent: Raquel Garcia")).toBeVisible();
  await prompt.getByRole("button", { name: "Yes, same child" }).click();
  await expect(page.getByText(/already on file — updated, not added again/)).toBeVisible();

  const { data: students } = await admin.from("students").select("id, medical_notes");
  expect(students).toEqual([{ id: miaId, medical_notes: "Peanut allergy — EpiPen" }]);
});

test("Add to roster uses the family on file, whatever way the phone was typed", async ({ page }) => {
  const miaId = await seedMia();
  const { programId } = await seedProgram();
  await register(programId, "Mia", {
    childLastName: "Garcia",
    parentFirstName: "Raquel",
    parentLastName: "Garcia",
    parentPhone: "915-500-2487",
  });
  await admin.from("registrations").update({ medical_notes: "EpiPen in her bag" }).eq("program_id", programId);

  await signIn(page);
  await page.goto("/registrations");
  await page.getByRole("button", { name: /add to roster/i }).click();
  await expect(page.getByText("Added to the roster")).toBeVisible();

  const { data: students } = await admin.from("students").select("id, medical_notes");
  expect(students).toEqual([{ id: miaId, medical_notes: "EpiPen in her bag" }]);
});

test("a double tap on Add Lead adds one lead", async ({ page }) => {
  await signIn(page);
  await page.goto("/marketing");
  await page.getByRole("button", { name: "Add Lead" }).click();
  await page.locator('input[name="school_name"]').fill("Roosevelt Elementary");
  await page.getByRole("button", { name: "Add Lead" }).last().dblclick();
  await expect(page.getByText("Lead added")).toBeVisible();

  const { count } = await admin.from("leads").select("*", { count: "exact", head: true });
  expect(count).toBe(1);
});
