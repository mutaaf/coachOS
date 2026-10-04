import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Issue #36: "What does the Garcia family owe?" took three screens and adding
 * it up herself. Now Parents and invoices each show a Balance, and a name opens
 * the family: children, parents, what they owe, messages and their pay link.
 */

function businessMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}

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

/** Raquel and Miguel Garcia, parents of Mia and Leo; $40 paid on Mia's $90. */
async function garcias() {
  const { programId } = await seedProgram({ monthlyFee: 90 });
  const { data: parents } = await admin
    .from("parents")
    .insert([
      { first_name: "Raquel", last_name: "Garcia", phone: "+12145550101" },
      { first_name: "Miguel", last_name: "Garcia", phone: "+12145550102" },
    ])
    .select("id, first_name, pay_token");
  const mom = parents!.find((p) => p.first_name === "Raquel")!;
  const dad = parents!.find((p) => p.first_name === "Miguel")!;
  const { data: kids } = await admin
    .from("students")
    .insert([
      { first_name: "Mia", last_name: "Garcia" },
      { first_name: "Leo", last_name: "Garcia" },
    ])
    .select("id, first_name");
  const mia = kids!.find((k) => k.first_name === "Mia")!;
  const leo = kids!.find((k) => k.first_name === "Leo")!;
  await admin.from("student_parents").insert([
    { student_id: mia.id, parent_id: mom.id, relationship: "mother" },
    { student_id: leo.id, parent_id: mom.id, relationship: "mother" },
    { student_id: mia.id, parent_id: dad.id, relationship: "father" },
    { student_id: leo.id, parent_id: dad.id, relationship: "father" },
  ]);
  await admin.from("enrollments").insert([
    { student_id: mia.id, program_id: programId, status: "active" },
    { student_id: leo.id, program_id: programId, status: "active" },
  ]);
  const month = businessMonth();
  const { data: invs } = await admin
    .from("invoices")
    .insert([
      { parent_id: mom.id, student_id: mia.id, program_id: programId, amount: 90, month, due_date: `${month}-01`, status: "overdue" },
      { parent_id: dad.id, student_id: leo.id, program_id: programId, amount: 90, month, due_date: `${month}-01`, status: "overdue" },
    ])
    .select("id, student_id");
  const miaInvoice = invs!.find((i) => i.student_id === mia.id)!.id;
  await admin.from("payments").insert({ invoice_id: miaInvoice, amount: 40, method: "cash" });
  // Queued with the number as she might type it; the family still gets it.
  await admin.from("message_queue").insert({
    recipient_phone: "(214) 555-0101",
    recipient_name: "Raquel Garcia",
    message: "Hi Raquel, practice moves to 5pm Thursday",
    status: "pending",
  });
  return { mom, dad };
}

test("Payments shows what is left on each invoice beside the fee", async ({ page }) => {
  await garcias();
  await signIn(page);
  await page.goto("/payments");

  const mia = page.locator("tr", { hasText: "Mia Garcia" });
  await expect(mia).toContainText("$90.00");
  await expect(mia.getByTestId("invoice-balance")).toHaveText("$50.00");
  await expect(page.locator("tr", { hasText: "Leo Garcia" }).getByTestId("invoice-balance")).toHaveText("$90.00");
});

test("Parents shows each family's balance, and a name opens the whole family", async ({ page }) => {
  const { mom } = await garcias();
  await signIn(page);
  await page.goto("/students");
  await page.getByRole("tab", { name: /^Parents \(/ }).click();

  for (const name of ["Raquel Garcia", "Miguel Garcia"]) {
    await expect(page.locator("tr", { hasText: name }).getByTestId("parent-balance")).toContainText("$140.00");
  }

  await page.getByRole("link", { name: "Raquel Garcia" }).click();
  await expect(page).toHaveURL(new RegExp(`/students/family/${mom.id}`));
  await expect(page.getByRole("heading", { name: "The Garcia family" })).toBeVisible();
  await expect(page.getByTestId("family-owed")).toHaveText("$140.00");

  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Children" }).locator("..")).toContainText("Mia Garcia");
  await expect(main.getByRole("heading", { name: "Children" }).locator("..")).toContainText("Leo Garcia");
  await expect(main.getByRole("heading", { name: "Parents & guardians" }).locator("..")).toContainText("Miguel Garcia");
  await expect(main.getByRole("heading", { name: "Messages" }).locator("..")).toContainText(
    "Hi Raquel, practice moves to 5pm Thursday"
  );
  await expect(main).toContainText(`/pay/${mom.pay_token}`);
});

test("a child's name opens their family", async ({ page }) => {
  await garcias();
  await signIn(page);
  await page.goto("/students");
  await page.getByRole("link", { name: "Leo Garcia" }).click();
  await expect(page).toHaveURL(/\/students\/family\//);
  await expect(page.getByTestId("family-owed")).toHaveText("$140.00");
});
