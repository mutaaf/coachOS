import { test } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * A way to actually look at the thing, not an assertion.
 *
 *   CAPTURE=1 npx playwright test tests/e2e/screenshots.spec.ts
 *
 * Images land in tests/screenshots/. Overflow can be measured; whether a page is
 * comfortable to use at 375px has to be seen. Off unless CAPTURE is set, so it
 * does not slow the suite down or write files on every run.
 */

const capture = process.env.CAPTURE ? test : test.skip;

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test.use({ viewport: { width: 375, height: 812 } });

capture("capture the dashboard on a phone", async ({ page }) => {
  await ensureTestUser();
  await truncateAll();

  const { programId } = await seedProgram({ capacity: 12, monthlyFee: 150 });

  for (const [first, last] of [
    ["Abdulrahman", "Al-Muhammadi"],
    ["Khadijah", "Abdurrahman-Siddiqui"],
    ["Bilal", "Yusuf"],
  ]) {
    const { data: parent } = await admin
      .from("parents")
      .insert({
        first_name: first,
        last_name: last,
        phone: `+1214555${Math.floor(1000 + Math.random() * 8999)}`,
      })
      .select("id")
      .single();
    const { data: student } = await admin
      .from("students")
      .insert({ first_name: first, last_name: last, grade: "3rd" })
      .select("id")
      .single();
    await admin
      .from("student_parents")
      .insert({ student_id: student!.id, parent_id: parent!.id, relationship: "parent" });
    await admin
      .from("enrollments")
      .insert({ student_id: student!.id, program_id: programId, status: "active" });
    await admin.from("invoices").insert({
      parent_id: parent!.id,
      student_id: student!.id,
      program_id: programId,
      amount: 150,
      month: today().slice(0, 7),
      due_date: `${today().slice(0, 7)}-01`,
      status: "pending",
    });
  }

  await admin.from("coaches").insert({
    first_name: "Abdulrahman",
    last_name: "Al-Muhammadi",
    phone: "+12145550001",
    pay_type: "per_session",
    pay_rate: 40,
    source: "Facebook Marketplace",
  });

  await admin.from("schedule_templates").insert({
    program_id: programId,
    day_of_week: new Date().getDay(),
    start_time: "16:00",
    end_time: "17:00",
    location: "Main Gymnasium",
  });
  await admin.from("sessions").insert({
    program_id: programId,
    date: today(),
    start_time: "16:00",
    end_time: "17:00",
    status: "scheduled",
  });

  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/);

  for (const path of ["/dashboard", "/students", "/payments", "/schedule", "/coaches", "/registrations"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: `tests/screenshots/${path.replace("/", "") || "home"}-375.png`,
      fullPage: true,
    });
  }

  await truncateAll();
});
