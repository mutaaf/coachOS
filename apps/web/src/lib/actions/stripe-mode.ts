"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { getStripeSettings, modeOfKey, stripeFor, type StripeMode } from "@/lib/stripe-client";

/**
 * Ask Stripe whose account a key belongs to and which mode it is, before
 * anything is switched to it. A live key pasted into the test box, a key from
 * the wrong business's account, a revoked key — all are caught here rather
 * than when a parent tries to pay.
 */
export async function checkStripeConnection(mode: StripeMode) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { keys } = await getStripeSettings();
  const secret = keys[mode].secret;
  if (!secret) return { error: `No ${mode} secret key saved yet.` };

  const prefixMode = modeOfKey(secret);
  if (prefixMode !== mode) {
    return {
      error:
        prefixMode === null
          ? "That doesn't look like a Stripe secret key (it should start with sk_test_ or sk_live_)."
          : `That's a ${prefixMode} key in the ${mode} box.`,
    };
  }

  try {
    const stripe = stripeFor(secret);
    const [account, balance] = await Promise.all([stripe.accounts.retrieve(), stripe.balance.retrieve()]);
    const name =
      account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id;
    const live = balance.livemode;
    if ((mode === "live") !== live) {
      return { error: `Stripe says this key is in ${live ? "live" : "test"} mode, not ${mode}.` };
    }
    return {
      success: true as const,
      account: name,
      mode,
      chargesEnabled: account.charges_enabled,
      webhookSaved: !!keys[mode].webhook,
    };
  } catch (err) {
    return { error: `Stripe refused the key: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Switch between Stripe's sandbox and live mode.
 *
 * The target mode's keys are checked with Stripe first. Families whose autopay
 * was set up in the other mode are turned off, because their saved card or
 * bank account doesn't exist in this one; they get to set it up again from
 * their payment page. Nothing else changes: invoices, payments and the books
 * are the same in both modes.
 */
export async function setStripeMode(mode: StripeMode) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (mode !== "test" && mode !== "live") return { error: "Pick test or live." };

  const check = await checkStripeConnection(mode);
  if ("error" in check && check.error) return { error: `Not switched. ${check.error}` };
  if (!("webhookSaved" in check) || !check.webhookSaved) {
    return { error: `Not switched. Save the ${mode} webhook secret first — without it, bank payments never get marked paid.` };
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase.from("config").update({ value: mode }).eq("key", "stripe_mode");
  if (error) return { error: error.message };

  const { data: turnedOff } = await supabase
    .from("parents")
    .update({
      autopay_status: "off",
      autopay_payment_method_id: null,
      autopay_label: null,
      autopay_verify_url: null,
      autopay_enabled_at: null,
    })
    .neq("autopay_status", "off")
    .neq("autopay_mode", mode)
    .select("id");

  revalidatePath("/", "layout");
  return { success: true as const, mode, account: check.account, autopayTurnedOff: turnedOff?.length ?? 0 };
}
