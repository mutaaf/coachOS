import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";

export const STRIPE_API_VERSION = "2026-01-28.clover";

/**
 * Stripe, if the owner has turned it on in Settings; otherwise null.
 *
 * The key lives in the config table rather than the environment so it can be
 * set from the dashboard without a redeploy.
 */
export async function getStripeClient(): Promise<Stripe | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("config")
    .select("key, value")
    .in("key", ["stripe_enabled", "stripe_secret_key"]);

  const config = Object.fromEntries((data || []).map((c) => [c.key, c.value]));

  if (config.stripe_enabled !== "true" || !config.stripe_secret_key) {
    return null;
  }

  return new Stripe(config.stripe_secret_key, { apiVersion: STRIPE_API_VERSION });
}
