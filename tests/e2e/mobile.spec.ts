import { test, expect, type Page } from "@playwright/test";
import {
  admin,
  ensureTestUser,
  issueAttendanceLink,
  seedProgram,
  truncateAll,
  TEST_USER,
} from "../helpers/db";

/**
 * Almost nobody uses this on a desktop.
 *
 * Parents register from a WhatsApp link on a phone, coaches take the register
 * standing in a gym, and the owner works from a tablet. So "does it fit" is
 * checked the only way that is not a matter of opinion: the page must not
 * scroll sideways, and the things you tap must be big enough to hit.
 */

const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPad mini", width: 768, height: 1024 },
];

/** How far the page can exceed the viewport before it counts as broken. */
const TOLERANCE = 2;

/** Today in the business's timezone, without importing app code. */
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      // SVG internals have `overflow: hidden` by default per spec, which is
      // about the SVG's own viewport, not about clipping page content. Walking
      // up from a <path> stops at its <svg> and reports a false positive.
      if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= doc.clientWidth + 2) continue;

      // Walk up to the FIRST ancestor that establishes an overflow context.
      // That one decides: `auto`/`scroll` means the content can be reached,
      // `hidden` means it is silently cut off. An earlier version kept walking
      // past a clipping ancestor to find a scrollable one further up, which is
      // how a 720px table inside a 341px `overflow-hidden` wrapper passed —
      // the page did not scroll sideways because the columns were simply gone.
      let node: HTMLElement | null = el;
      let verdict: "reachable" | "clipped" = "clipped";
      while (node) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") {
          verdict = "reachable";
          break;
        }
        if (overflowX === "hidden" && node !== el) break;
        node = node.parentElement;
      }

      if (verdict === "clipped") {
        offenders.push(
          `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> ` +
            `width=${Math.round(rect.width)} right=${Math.round(rect.right)}`
        );
      }
    }

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      offenders: offenders.slice(0, 5),
    };
  });
}

/**
 * Enough real data that the tables actually render rows.
 *
 * Without this the dashboard pages show empty states, the tables never get wide,
 * and the overflow check passes while proving nothing. Long names and references
 * are deliberate — that is what pushes a table past the screen.
 */
async function seedRealisticData() {
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
        email: `${first.toLowerCase()}@example.test`,
      })
      .select("id")
      .single();

    const { data: student } = await admin
      .from("students")
      .insert({
        first_name: first,
        last_name: last,
        grade: "3rd",
        medical_notes: "Severe peanut allergy — inhaler kept in the blue bag",
      })
      .select("id")
      .single();

    await admin
      .from("student_parents")
      .insert({ student_id: student!.id, parent_id: parent!.id, relationship: "parent" });
    await admin
      .from("enrollments")
      .insert({ student_id: student!.id, program_id: programId, status: "active" });

    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        parent_id: parent!.id,
        student_id: student!.id,
        program_id: programId,
        amount: 150,
        month: today().slice(0, 7),
        due_date: `${today().slice(0, 7)}-01`,
        status: "pending",
      })
      .select("id")
      .single();

    await admin.from("payments").insert({
      invoice_id: invoice!.id,
      parent_id: parent!.id,
      amount: 150,
      method: "zelle",
      reference: "ZELLE-CONF-8842190375",
      paid_at: today(),
    });
  }

  await admin.from("coaches").insert({
    first_name: "Abdulrahman",
    last_name: "Al-Muhammadi",
    phone: "+12145550001",
    pay_type: "per_session",
    pay_rate: 40,
    source: "Facebook Marketplace",
    notes: "Basketball and soccer, available Tuesdays and Thursdays after 4pm",
  });

  await admin.from("schedule_templates").insert({
    program_id: programId,
    day_of_week: 2,
    start_time: "16:00",
    end_time: "17:00",
    location: "Main Gymnasium, East Entrance",
  });

  await admin.from("sessions").insert({
    program_id: programId,
    date: today(),
    start_time: "16:00",
    end_time: "17:00",
    status: "scheduled",
  });
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(TEST_USER.email);
  await page.locator("#password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(ensureTestUser);
test.afterAll(truncateAll);

const DASHBOARD_PAGES = [
  "/dashboard",
  "/registrations",
  "/coaches",
  "/students",
  "/schools",
  "/payments",
  "/schedule",
  "/messaging",
  "/marketing",
  "/settings",
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the pages a parent and coach see fit the screen", async ({ page }) => {
      await truncateAll();
      const { programId, slug } = await seedProgram({ capacity: 12 });

      // A roster big enough that long names and notes are actually exercised.
      for (const name of ["Amina", "Abdulrahman", "Bilal"]) {
        const { data: student } = await admin
          .from("students")
          .insert({
            first_name: name,
            last_name: "Al-Muhammadi",
            medical_notes: name === "Bilal" ? "Severe peanut allergy — inhaler in bag" : null,
          })
          .select("id")
          .single();
        await admin
          .from("enrollments")
          .insert({ student_id: student!.id, program_id: programId, status: "active" });
      }

      const { data: session } = await admin
        .from("sessions")
        .insert({
          program_id: programId,
          date: today(),
          start_time: "16:00",
          end_time: "17:00",
          status: "scheduled",
        })
        .select("id")
        .single();
      const link = await issueAttendanceLink(session!.id);

      // Registration, as a parent opens it.
      await page.goto(`/join/${slug}`);
      const join = await horizontalOverflow(page);
      expect(join.offenders, `/join overflows: ${join.offenders.join(" | ")}`).toEqual([]);
      expect(join.scrollWidth).toBeLessThanOrEqual(join.clientWidth + TOLERANCE);

      // The register, as a coach opens it.
      await page.goto(`/s/${link.token}`);
      await page.getByLabel("Passcode").fill(link.passcode);
      await page.getByRole("button", { name: /open register/i }).click();
      await expect(page.getByText("Al-Muhammadi").first()).toBeVisible();

      const sheet = await horizontalOverflow(page);
      expect(sheet.offenders, `/s overflows: ${sheet.offenders.join(" | ")}`).toEqual([]);
      expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth + TOLERANCE);
    });

    test("the register's tap targets are big enough to hit", async ({ page }) => {
      await truncateAll();
      const { programId } = await seedProgram({});
      const { data: student } = await admin
        .from("students")
        .insert({ first_name: "Amina", last_name: "Yusuf" })
        .select("id")
        .single();
      await admin
        .from("enrollments")
        .insert({ student_id: student!.id, program_id: programId, status: "active" });
      const { data: session } = await admin
        .from("sessions")
        .insert({
          program_id: programId,
          date: today(),
          start_time: "16:00",
          end_time: "17:00",
          status: "scheduled",
        })
        .select("id")
        .single();
      const link = await issueAttendanceLink(session!.id);

      await page.goto(`/s/${link.token}`);
      await page.getByLabel("Passcode").fill(link.passcode);
      await page.getByRole("button", { name: /open register/i }).click();

      // 44px is the long-standing floor for a finger. This is used one-handed,
      // standing up, often in a hurry.
      const row = page.locator("li button").first();
      const box = await row.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);

      const save = page.getByRole("button", { name: /save register/i });
      const saveBox = await save.boundingBox();
      expect(saveBox!.height).toBeGreaterThanOrEqual(44);
    });

    test("every dashboard page fits, with real rows in it", async ({ page }) => {
      await truncateAll();
      await seedRealisticData();
      await signIn(page);

      for (const path of DASHBOARD_PAGES) {
        await page.goto(path);
        // Wait for the skeleton to be replaced by real content.
        await page.waitForLoadState("networkidle");

        const result = await horizontalOverflow(page);
        expect(
          result.offenders,
          `${path} at ${viewport.width}px overflows: ${result.offenders.join(" | ")}`
        ).toEqual([]);
        expect(
          result.scrollWidth,
          `${path} scrolls sideways at ${viewport.width}px`
        ).toBeLessThanOrEqual(result.clientWidth + TOLERANCE);
      }
    });
  });
}
