import { test, expect, type Page } from "@playwright/test";
import { admin, ensureTestUser, seedProgram, truncateAll, TEST_USER } from "../helpers/db";

/**
 * Sending from the owner's own phone: queued messages open WhatsApp with the
 * text written, and are ticked off as they go.
 *
 * wa.me is intercepted, so the test never leaves the machine; what matters is
 * the link the button carries and what the app records.
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

async function queue(name: string, phone: string, message: string) {
  const { data } = await admin
    .from("message_queue")
    .insert({ recipient_name: name, recipient_phone: phone, message, status: "pending" })
    .select("id")
    .single();
  return data!.id as string;
}

test("a queued message opens WhatsApp with the text written, and is ticked off", async ({ page, context }) => {
  await context.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp" }));
  const id = await queue("Raquel Garcia", "(915) 500-2487", "Hi Raquel! Pay here: https://x.test/pay/abc");
  await queue("Star Okafor", "+19728918266", "Hi Star!");

  await signIn(page);
  await page.goto("/messaging");

  // The outbox is where she lands when something is waiting.
  await expect(page.getByRole("heading", { name: "2 to send" })).toBeVisible();
  const first = page.getByTestId("outbox-message").first();
  const wa = first.getByRole("link", { name: "WhatsApp" });
  await expect(wa).toHaveAttribute(
    "href",
    `https://wa.me/19155002487?text=${encodeURIComponent("Hi Raquel! Pay here: https://x.test/pay/abc")}`
  );

  const popup = page.waitForEvent("popup");
  await wa.click();
  await (await popup).close();

  await expect(page.getByRole("heading", { name: "1 to send" })).toBeVisible();
  await expect(page.getByText("Raquel Garcia · on WhatsApp")).toBeVisible();
  await expect
    .poll(async () => (await admin.from("message_queue").select("status, sent_via").eq("id", id).single()).data)
    .toEqual({ status: "sent", sent_via: "whatsapp" });
  const { count } = await admin.from("message_log").select("id", { count: "exact", head: true }).eq("queue_id", id);
  expect(count).toBe(1);

  // A mis-tap comes back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "2 to send" })).toBeVisible();
  await expect
    .poll(async () => (await admin.from("message_queue").select("status").eq("id", id).single()).data?.status)
    .toBe("pending");
});

test("preparing payment links lands her in the outbox with one message per family", async ({ page }) => {
  const keys = ["stripe_enabled", "stripe_test_secret_key"];
  const { data: before } = await admin.from("config").select("key, value").in("key", keys);
  await admin.from("config").update({ value: "true" }).eq("key", "stripe_enabled");
  await admin.from("config").update({ value: "sk_test_render_only" }).eq("key", "stripe_test_secret_key");
  try {
    const { programId } = await seedProgram({});
    const { data: parent } = await admin
      .from("parents")
      .insert({ first_name: "Tina", last_name: "Okafor", phone: "+12145550142" })
      .select("id, pay_token")
      .single();
    for (const name of ["Ada", "Obi"]) {
      const { data: s } = await admin.from("students").insert({ first_name: name, last_name: "Okafor" }).select("id").single();
      await admin.from("student_parents").insert({ student_id: s!.id, parent_id: parent!.id });
      await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
    }

    await signIn(page);
    await page.goto("/payments");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Send 1 payment link" }).click();

    await expect(page).toHaveURL(/\/messaging\?tab=outbox/);
    await expect(page.getByRole("heading", { name: "1 to send" })).toBeVisible();
    const msg = page.getByTestId("outbox-message");
    await expect(msg).toContainText("Ada and Obi");
    await expect(msg.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/12145550142\\?text=.*${parent!.pay_token}`)
    );
  } finally {
    for (const r of before || []) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  }
});
