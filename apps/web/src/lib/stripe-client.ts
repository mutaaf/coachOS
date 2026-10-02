import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";

export const STRIPE_API_VERSION = "2026-01-28.clover";

export type StripeMode = "test" | "live";

export interface StripeSettings {
  enabled: boolean;
  /** Which set of keys is in use. */
  mode: StripeMode;
  keys: Record<StripeMode, { secret: string; webhook: string }>;
}

/**
 * Stripe's settings, read fresh each time so a switch in Settings takes effect
 * on the next request — no deploy.
 *
 * Both modes' keys are kept: test is the sandbox, live moves real money, and
 * the owner can go back and forth. Everything that talks to Stripe gets its
 * keys from here.
 */
export async function getStripeSettings(): Promise<StripeSettings> {
  const { data } = await createAdminSupabase()
    .from("config")
    .select("key, value")
    .in("key", [
      "stripe_enabled",
      "stripe_mode",
      "stripe_test_secret_key",
      "stripe_test_webhook_secret",
      "stripe_live_secret_key",
      "stripe_live_webhook_secret",
    ]);
  const c = Object.fromEntries((data || []).map((r) => [r.key, ((r.value as string) ?? "").trim()]));
  return {
    enabled: c.stripe_enabled === "true",
    mode: c.stripe_mode === "live" ? "live" : "test",
    keys: {
      test: { secret: c.stripe_test_secret_key ?? "", webhook: c.stripe_test_webhook_secret ?? "" },
      live: { secret: c.stripe_live_secret_key ?? "", webhook: c.stripe_live_webhook_secret ?? "" },
    },
  };
}

/** Whether payments by Stripe are on and the current mode has a key. */
export function stripeReady(s: StripeSettings): boolean {
  return s.enabled && !!s.keys[s.mode].secret;
}

export function stripeFor(secret: string): Stripe {
  return new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
}

/**
 * Stripe in the current mode, if the owner has turned it on; otherwise null.
 */
export async function getStripeClient(): Promise<Stripe | null> {
  const s = await getStripeSettings();
  if (!stripeReady(s)) return null;
  return stripeFor(s.keys[s.mode].secret);
}

/** The mode a key belongs to, from its prefix — sk_test_ / sk_live_ (rk_ for restricted keys). */
export function modeOfKey(secret: string): StripeMode | null {
  if (/^(sk|rk)_test_/.test(secret)) return "test";
  if (/^(sk|rk)_live_/.test(secret)) return "live";
  return null;
}
