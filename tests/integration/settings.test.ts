import { describe, it, expect, afterEach } from "vitest";
import { admin } from "../helpers/db";
import { updateConfig, updateMultipleConfigs } from "@/lib/actions/config";

/**
 * Settings hold the Stripe keys and where parents send money. Changing them
 * must take a signed-in admin — the actions are callable by anyone who has
 * their id.
 */

let saved: string | null = null;
afterEach(async () => {
  if (saved !== null) await admin.from("config").update({ value: saved }).eq("key", "zelle_recipient");
});

describe("changing settings", () => {
  it("refuses anyone who isn't signed in, and changes nothing", async () => {
    (globalThis as any).__signedOut = true;
    const { data } = await admin.from("config").select("value").eq("key", "zelle_recipient").single();
    saved = data!.value;

    expect(await updateConfig("zelle_recipient", "attacker@example.com")).toHaveProperty("error");
    expect(await updateMultipleConfigs([{ key: "zelle_recipient", value: "attacker@example.com" }])).toHaveProperty(
      "error"
    );

    const { data: after } = await admin.from("config").select("value").eq("key", "zelle_recipient").single();
    expect(after!.value).toBe(saved);
  });

  it("knows which settings are secrets, addresses and links", async () => {
    const { data } = await admin.from("config").select("key, field_type");
    const type = Object.fromEntries(data!.map((r) => [r.key, r.field_type]));
    expect(type.stripe_test_secret_key).toBe("secret");
    expect(type.stripe_test_webhook_secret).toBe("secret");
    expect(type.stripe_live_secret_key).toBe("secret");
    expect(type.stripe_live_webhook_secret).toBe("secret");
    // Replaced by the per-mode keys.
    expect(type.stripe_secret_key).toBeUndefined();
    expect(type.zelle_inbound_secret).toBe("secret");
    expect(type.email_reply_to).toBe("email");
    expect(type.zelle_alerts_inbox).toBe("email");
    expect(type.zelle_alerts_forward_from).toBe("email");
    // The bot is gone, and so is its setting.
    expect(type.whatsapp_bot_url).toBeUndefined();
  });
});
