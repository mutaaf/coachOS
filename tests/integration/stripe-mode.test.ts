import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Stripe from "stripe";
import { admin, truncateAll } from "../helpers/db";
import { modeOfKey, getStripeSettings } from "@/lib/stripe-client";
import { checkStripeConnection, setStripeMode } from "@/lib/actions/stripe-mode";
import { autopayPayersByStudent, saveSetupIntent } from "@/lib/autopay";
import { POST as webhook } from "@/app/api/webhooks/stripe/route";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Test mode and live mode. A card saved in one doesn't exist in the other, so
 * the thing to prove is that nothing is ever charged across modes — and that
 * the switch itself can only be thrown by a signed-in admin.
 */

const db = admin as unknown as OpsClient;
const KEYS = [
  "stripe_enabled",
  "stripe_mode",
  "stripe_test_secret_key",
  "stripe_test_webhook_secret",
  "stripe_live_secret_key",
  "stripe_live_webhook_secret",
];
let saved: { key: string; value: string }[] = [];
const set = (key: string, value: string) => admin.from("config").update({ value }).eq("key", key);

beforeEach(async () => {
  saved = (await admin.from("config").select("key, value").in("key", KEYS)).data || [];
});
afterEach(async () => {
  for (const r of saved) await set(r.key, r.value);
  await truncateAll();
});

describe("which mode a key is", () => {
  it.each([
    ["sk_test_abc", "test"],
    ["rk_test_abc", "test"],
    ["sk_live_abc", "live"],
    ["pk_live_abc", null],
    ["whsec_abc", null],
  ])("%s is %s", (key, mode) => {
    expect(modeOfKey(key)).toBe(mode);
  });
});

describe("the switch", () => {
  it("can't be checked or thrown by anyone who isn't signed in", async () => {
    await set("stripe_mode", "test");
    expect(await checkStripeConnection("live")).toHaveProperty("error", expect.stringMatching(/sign in/i));
    expect(await setStripeMode("live")).toHaveProperty("error", expect.stringMatching(/sign in/i));
    expect((await getStripeSettings()).mode).toBe("test");
  });

  it("reads both modes' keys, and the mode in use", async () => {
    await set("stripe_mode", "live");
    await set("stripe_live_secret_key", "sk_live_x");
    await set("stripe_test_secret_key", "sk_test_y");
    const s = await getStripeSettings();
    expect(s.mode).toBe("live");
    expect(s.keys.live.secret).toBe("sk_live_x");
    expect(s.keys.test.secret).toBe("sk_test_y");
  });
});

describe("saved cards belong to a mode", () => {
  async function parent(name: string) {
    const { data } = await admin
      .from("parents")
      .insert({ first_name: name, last_name: "Test", phone: `+1214555${Math.floor(1000 + Math.random() * 8999)}` })
      .select("id")
      .single();
    const { data: s } = await admin.from("students").insert({ first_name: `${name}Kid`, last_name: "Test" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: data!.id });
    return { parentId: data!.id as string, studentId: s!.id as string };
  }

  const card = { id: "pm_1", type: "card", card: { brand: "visa", last4: "4242" } };

  it("records which mode a card was saved in", async () => {
    const live = await parent("Live");
    const test = await parent("Sandbox");

    await saveSetupIntent(db, { status: "succeeded", livemode: true, metadata: { parent_id: live.parentId }, payment_method: card } as any);
    await saveSetupIntent(db, { status: "succeeded", livemode: false, metadata: { parent_id: test.parentId }, payment_method: { ...card, id: "pm_2" } } as any);

    const { data } = await admin.from("parents").select("first_name, autopay_mode").in("id", [live.parentId, test.parentId]);
    expect(Object.fromEntries(data!.map((p) => [p.first_name, p.autopay_mode]))).toEqual({ Live: "live", Sandbox: "test" });
  });

  it("only charges cards saved in the mode in use", async () => {
    const live = await parent("Live");
    const test = await parent("Sandbox");
    await saveSetupIntent(db, { status: "succeeded", livemode: true, metadata: { parent_id: live.parentId }, payment_method: card } as any);
    await saveSetupIntent(db, { status: "succeeded", livemode: false, metadata: { parent_id: test.parentId }, payment_method: { ...card, id: "pm_2" } } as any);

    const inLive = await autopayPayersByStudent(db, "live");
    const inTest = await autopayPayersByStudent(db, "test");

    expect([...inLive.keys()]).toEqual([live.studentId]);
    expect([...inTest.keys()]).toEqual([test.studentId]);
  });
});

describe("the webhook", () => {
  // Signatures are checked with Stripe's own library; no network involved.
  const signer = new Stripe("sk_test_signing_only");
  function signed(payload: object, secret: string) {
    const body = JSON.stringify(payload);
    const header = signer.webhooks.generateTestHeaderString({ payload: body, secret });
    return new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      body,
    }) as any;
  }
  const event = (livemode: boolean) => ({
    id: "evt_1",
    object: "event",
    type: "customer.created",
    livemode,
    data: { object: {} },
  });

  beforeEach(async () => {
    await set("stripe_test_secret_key", "sk_test_a");
    await set("stripe_test_webhook_secret", "whsec_test_secret");
    await set("stripe_live_secret_key", "sk_live_b");
    await set("stripe_live_webhook_secret", "whsec_live_secret");
  });

  it("accepts events from both modes, each signed with its own secret", async () => {
    expect((await webhook(signed(event(false), "whsec_test_secret"))).status).toBe(200);
    expect((await webhook(signed(event(true), "whsec_live_secret"))).status).toBe(200);
  });

  it("refuses an event signed with anything else", async () => {
    expect((await webhook(signed(event(true), "whsec_forged"))).status).toBe(400);
  });
});
