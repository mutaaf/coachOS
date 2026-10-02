"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe-client";
import { appUrl } from "@/lib/app-url";
import { getOrCreateStripeCustomer } from "@/lib/actions/stripe";
import { isPayToken } from "@/lib/queries/pay-page";
import { findSender, senderKey } from "@/lib/zelle";
import { isEmail } from "@/lib/email";

/**
 * What a parent can do from their payment page.
 *
 * These are public — the page has no login — so each one takes the page's
 * token and acts only on the parent it belongs to. Nothing here can reach
 * another family, read anything back beyond what the page already shows, or
 * move money: charging happens later, from the cron, against what was saved.
 */

async function parentForToken(token: string) {
  if (typeof token !== "string" || !isPayToken(token)) return null;
  const { data } = await createAdminSupabase()
    .from("parents")
    .select("id, autopay_payment_method_id")
    .eq("pay_token", token)
    .maybeSingle();
  return data;
}

const NOT_FOUND = { error: "This payment link isn't working. Message us for a new one." };

/** Send the parent to Stripe to save a bank account or card. */
export async function startAutopaySetup(token: string, method: "us_bank_account" | "card") {
  if (method !== "us_bank_account" && method !== "card") return { error: "Pick bank or card." };

  const parent = await parentForToken(token);
  if (!parent) return NOT_FOUND;

  const stripe = await getStripeClient();
  if (!stripe) return { error: "Automatic payments aren't available yet. Please use Zelle for now." };

  const customer = await getOrCreateStripeCustomer(parent.id);
  if ("error" in customer) return { error: customer.error };

  // Back to wherever the parent actually is — production, or a preview.
  const origin = headers().get("origin") || appUrl();
  const page = `${origin}/pay/${token}`;

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    customer: customer.customerId,
    payment_method_types: [method],
    ...(method === "us_bank_account"
      ? {
          payment_method_options: {
            us_bank_account: {
              // Instant through the parent's bank login where it can; falls back
              // to micro-deposits, which the page then walks them through.
              verification_method: "automatic",
              financial_connections: { permissions: ["payment_method"] },
            },
          },
        }
      : {}),
    setup_intent_data: {
      description: "Monthly program fees, charged on the due date",
      metadata: { parent_id: parent.id },
    },
    metadata: { parent_id: parent.id },
    success_url: `${page}?setup={CHECKOUT_SESSION_ID}`,
    cancel_url: page,
  });

  if (!session.url) return { error: "Stripe didn't return a page to continue on. Please try again." };
  return { url: session.url };
}

/**
 * Stop charging. Cancelling has to be as easy as starting — one tap, on the
 * same page, no message to anyone.
 */
export async function turnOffAutopay(token: string) {
  const parent = await parentForToken(token);
  if (!parent) return NOT_FOUND;

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("parents")
    .update({
      autopay_status: "off",
      autopay_method: null,
      autopay_payment_method_id: null,
      autopay_label: null,
      autopay_verify_url: null,
      autopay_enabled_at: null,
    })
    .eq("id", parent.id);
  if (error) return { error: error.message };

  // Remove it from Stripe too, so nothing — a stale cron, a replayed request —
  // can charge it after the parent said stop.
  if (parent.autopay_payment_method_id) {
    const stripe = await getStripeClient();
    try {
      await stripe?.paymentMethods.detach(parent.autopay_payment_method_id);
    } catch {
      // Already detached. The row above is what the cron reads anyway.
    }
  }

  revalidatePath("/payments");
  return { success: true };
}

/**
 * "My Zelle comes from my husband's account." Saved so his payments match this
 * family without the owner having to work it out.
 */
export async function rememberZelleName(token: string, name: string) {
  const parent = await parentForToken(token);
  if (!parent) return NOT_FOUND;

  const key = senderKey(String(name ?? "").slice(0, 100));
  if (key.split(" ").filter(Boolean).length < 2) {
    return { error: "Please enter the first and last name on the account." };
  }

  const supabase = createAdminSupabase();

  // A name already tied to someone else — another family's alias, or another
  // parent's own name — is not something a page visitor gets to reassign.
  // Otherwise anyone with a link could have other families' payments credited
  // to their own account.
  const existing = await findSender(supabase, name);
  if (existing.parentId && existing.parentId !== parent.id) {
    return { error: "That name is already linked to another family. Message us and we'll sort it out." };
  }

  const { error } = await supabase
    .from("zelle_senders")
    .upsert({ sender_key: key, parent_id: parent.id }, { onConflict: "sender_key" });
  if (error) return { error: error.message };

  return { success: true };
}

/** Where receipts go. Replacing it is fine; the page never shows it in full. */
export async function saveParentEmail(token: string, email: string) {
  const parent = await parentForToken(token);
  if (!parent) return NOT_FOUND;
  const value = String(email ?? "").trim().toLowerCase().slice(0, 200);
  if (!isEmail(value)) return { error: "That doesn't look like an email address." };
  const { error } = await createAdminSupabase().from("parents").update({ email: value }).eq("id", parent.id);
  if (error) return { error: error.message };
  return { success: true };
}
