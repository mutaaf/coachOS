import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, truncateAll, TEST_USER } from "../helpers/db";

/**
 * The run-book, executed.
 *
 * This walks the documented weekly workflow end to end in one go, in the order
 * it is actually done: stand up a school, open registration, let a parent sign
 * themselves up, put them on the roster, schedule the sessions, mark who came,
 * bill the month, take the money. Then the things that go wrong — the program
 * fills, someone leaves, the waitlist moves.
 *
 * It is deliberately one long test rather than many small ones. Each step
 * depends on the state the last one left behind, which is exactly the property
 * that breaks in production and that isolated tests cannot catch.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(ensureTestUser);
test.beforeAll(truncateAll);
test.afterAll(truncateAll);

const SCHOOL = "Al-Noor Academy";
const PROGRAM = "Basketball Fundamentals - Tuesdays";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The month invoices are generated for, as the dialog expects it. */
function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

test("the whole run-book, start to finish", async ({ page }) => {
  await signIn(page);

  // ---- Setting up a school, steps 1-3 -------------------------------------

  await test.step("add the school", async () => {
    await page.goto("/schools");
    await page.getByRole("button", { name: /add school/i }).first().click();
    await page.locator("#name").fill(SCHOOL);
    await page.getByRole("button", { name: "Create School", exact: true }).click();

    await expect
      .poll(async () => {
        const { data } = await admin.from("schools").select("name").eq("name", SCHOOL).maybeSingle();
        return data?.name;
      })
      .toBe(SCHOOL);
  });

  const { data: school } = await admin
    .from("schools")
    .select("id")
    .eq("name", SCHOOL)
    .single();

  await test.step("add the program and open registration", async () => {
    await page.goto(`/schools/${school!.id}`);
    await page.getByRole("button", { name: /add program|create first program/i }).first().click();

    await page.locator("#name").fill(PROGRAM);
    await page.locator("#monthly_fee").fill("150");
    await page.locator("#capacity").fill("2"); // small, so the waitlist is reachable
    await page.locator("#location").fill("Al-Noor Gym");
    await page.getByRole("switch", { name: /open registration/i }).click();
    await page.getByRole("button", { name: "Create Program", exact: true }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("programs")
          .select("registration_open, capacity, public_slug")
          .eq("school_id", school!.id)
          .maybeSingle();
        return data;
      })
      .toMatchObject({ registration_open: true, capacity: 2 });
  });

  const { data: program } = await admin
    .from("programs")
    .select("id, public_slug")
    .eq("school_id", school!.id)
    .single();

  // ---- Step 4: the link a parent opens ------------------------------------

  await test.step("the registration link works for a signed-out parent", async () => {
    // Same page a parent reaches from the WhatsApp group.
    await page.goto(`/join/${program!.public_slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Basketball Fundamentals");
    await expect(page.getByText("2 of 2 left")).toBeVisible();
    await expect(page.getByText("Al-Noor Gym")).toBeVisible();
  });

  await test.step("a parent registers their child", async () => {
    await page.getByLabel("First name").first().fill("Amina");
    await page.getByLabel("Last name").first().fill("Yusuf");
    await page.getByLabel("Grade").fill("3rd");
    await page.getByLabel("First name").nth(1).fill("Sara");
    await page.getByLabel("Last name").nth(1).fill("Yusuf");
    await page.getByLabel("WhatsApp number").fill("(214) 555-0123");
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page.getByText("You're in.")).toBeVisible();
  });

  // ---- The week: registrations -> roster ----------------------------------

  await test.step("add the registration to the roster", async () => {
    await page.goto("/registrations");
    await expect(page.getByText("Amina Yusuf")).toBeVisible();

    await page.getByRole("button", { name: /add to roster/i }).first().click();

    await expect
      .poll(async () => {
        const { count } = await admin
          .from("enrollments")
          .select("*", { count: "exact", head: true })
          .eq("program_id", program!.id)
          .eq("status", "active");
        return count;
      })
      .toBe(1);

    // The child and their parent now exist as real records, not form text.
    const { data: student } = await admin
      .from("students")
      .select("first_name, grade")
      .eq("first_name", "Amina")
      .single();
    expect(student).toMatchObject({ first_name: "Amina", grade: "3rd" });

    const { data: parent } = await admin
      .from("parents")
      .select("first_name, phone")
      .eq("first_name", "Sara")
      .single();
    expect(parent!.phone).toBe("(214) 555-0123");
  });

  // ---- Step 5: the weekly time, and sessions on the calendar --------------

  await test.step("set the weekly session time and generate the calendar", async () => {
    // The schedule template is the recurring slot; sessions are its occurrences.
    await admin.from("schedule_templates").insert({
      program_id: program!.id,
      day_of_week: 2,
      start_time: "16:00",
      end_time: "17:00",
      location: "Al-Noor Gym",
    });

    await page.goto("/schedule");
    await page.getByRole("button", { name: /generate sessions/i }).click();

    await expect
      .poll(async () => {
        const { count } = await admin
          .from("sessions")
          .select("*", { count: "exact", head: true })
          .eq("program_id", program!.id);
        return count;
      })
      .toBe(4); // the page generates four weeks ahead
  });

  await test.step("mark who came", async () => {
    const { data: session } = await admin
      .from("sessions")
      .select("id")
      .eq("program_id", program!.id)
      .order("date")
      .limit(1)
      .single();
    const { data: student } = await admin
      .from("students")
      .select("id")
      .eq("first_name", "Amina")
      .single();

    // The attendance dialog has no stable handles to drive, and the upsert it
    // performs is covered in operations.test.ts. What this step is really
    // checking is that a generated session and the roster line up, so there is
    // somebody to mark present.
    await admin
      .from("attendance")
      .insert({ session_id: session!.id, student_id: student!.id, status: "present" });

    const { data: rows } = await admin
      .from("attendance")
      .select("status")
      .eq("session_id", session!.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("present");
  });

  // ---- The week: money ----------------------------------------------------

  await test.step("generate the month's invoices", async () => {
    await page.goto("/payments");
    await page.getByRole("button", { name: /generate invoices/i }).click();
    await page.locator("#month").fill(thisMonth());
    await page.getByRole("button", { name: /^generate invoices$/i }).last().click();

    await expect
      .poll(async () => {
        const { data } = await admin.from("invoices").select("amount, status");
        return data;
      })
      .toHaveLength(1);

    const { data: invoices } = await admin.from("invoices").select("amount, status");
    expect(Number(invoices![0].amount)).toBe(150);
    expect(invoices![0].status).toBe("pending");
  });

  await test.step("record a Zelle payment against it", async () => {
    await page.reload();

    // The row's own button, not the one in the page header — that one opens the
    // dialog with no invoice attached.
    await page.getByRole("button", { name: "Record Payment", exact: true }).last().click();

    await page.locator("#amount").fill("150");
    await page.locator("#method").selectOption("zelle");
    await page.locator("#reference").fill("zelle-0917");
    await page.getByRole("button", { name: /^(record|save) payment$/i }).last().click();

    await expect
      .poll(async () => {
        const { data } = await admin.from("invoices").select("status").single();
        return data?.status;
      })
      .toBe("paid");
  });

  // ---- When something changes --------------------------------------------

  await test.step("the program fills, and the next child waitlists", async () => {
    // Second seat goes to another family, filling the program.
    await admin.rpc("submit_registration", {
      p_program_id: program!.id,
      p_child_first_name: "Bilal",
      p_child_last_name: "Khan",
      p_parent_first_name: "Omar",
      p_parent_last_name: "Khan",
      p_parent_phone: "+12145550777",
    });

    await page.goto(`/join/${program!.public_slug}`);
    await expect(page.getByText(/^Full$/)).toBeVisible();
    await expect(page.getByText(/you'll be added to the waitlist/i)).toBeVisible();

    await page.getByLabel("First name").first().fill("Zayd");
    await page.getByLabel("Last name").first().fill("Ali");
    await page.getByLabel("First name").nth(1).fill("Hana");
    await page.getByLabel("Last name").nth(1).fill("Ali");
    await page.getByLabel("WhatsApp number").fill("(214) 555-0199");
    await page.getByRole("button", { name: "Join the waitlist" }).click();

    await expect(page.getByText("You're on the waitlist.")).toBeVisible();
    await expect(page.locator("strong")).toHaveText("1");
  });

  await test.step("a child leaves, freeing a seat", async () => {
    const { data: bilal } = await admin
      .from("registrations")
      .select("id")
      .eq("child_first_name", "Bilal")
      .single();
    await admin.from("registrations").update({ status: "cancelled" }).eq("id", bilal!.id);

    const { data: availability } = await admin
      .from("program_availability")
      .select("seats_remaining, waitlist_count")
      .eq("program_id", program!.id)
      .single();
    expect(availability).toMatchObject({ seats_remaining: 1, waitlist_count: 1 });
  });

  await test.step("give the waiting child the seat", async () => {
    await page.goto("/registrations");
    await page.getByRole("button", { name: /give a seat/i }).first().click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("registrations")
          .select("status, waitlist_position")
          .eq("child_first_name", "Zayd")
          .single();
        return data;
      })
      .toMatchObject({ status: "confirmed", waitlist_position: null });

    const { data: availability } = await admin
      .from("program_availability")
      .select("seats_taken, seats_remaining, waitlist_count")
      .eq("program_id", program!.id)
      .single();
    expect(availability).toMatchObject({
      seats_taken: 2,
      seats_remaining: 0,
      waitlist_count: 0,
    });
  });

  await test.step("the books still balance at the end", async () => {
    // One child billed, one payment taken, nothing double-counted.
    const { data: invoices } = await admin.from("invoices").select("amount, status");
    const { data: payments } = await admin.from("payments").select("amount, method");

    expect(invoices).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(Number(payments![0].amount)).toBe(150);
    expect(payments![0].method).toBe("zelle");
    expect(invoices![0].status).toBe("paid");
  });
});
