import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";
import { STRIPE_API_VERSION } from "@/lib/stripe-client";
import { recalculateInvoiceStatus } from "@/lib/invoice-status";
import { chargeSplits, failAutopay, saveSetupIntent, settleAutopay } from "@/lib/autopay";

async function getStripeConfig() {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("config")
    .select("key, value")
    .in("key", ["stripe_secret_key", "stripe_webhook_secret"]);

  return Object.fromEntries((data || []).map((c) => [c.key, c.value]));
}

export async function POST(request: NextRequest) {
  const config = await getStripeConfig();

  if (!config.stripe_secret_key || !config.stripe_webhook_secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(config.stripe_secret_key, { apiVersion: STRIPE_API_VERSION });
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, config.stripe_webhook_secret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  switch (event.type) {
    case "invoice.paid": {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      const invoiceId = stripeInvoice.metadata?.invoice_id;
      if (!invoiceId) break;

      // Stripe redelivers webhooks; the unique external_id makes a redelivery a
      // no-op instead of a second payment on the books.
      const { error } = await supabase.from("payments").insert({
        invoice_id: invoiceId,
        amount: (stripeInvoice.amount_paid || 0) / 100,
        method: "stripe",
        reference: stripeInvoice.id,
        notes: "Paid via Stripe",
        external_id: stripeInvoice.id,
      });
      if (error && error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await recalculateInvoiceStatus(supabase, invoiceId);
      break;
    }

    case "invoice.payment_failed": {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      const invoiceId = stripeInvoice.metadata?.invoice_id;
      if (invoiceId) await recalculateInvoiceStatus(supabase, invoiceId);
      break;
    }

    // A parent finished saving a bank account or card on their payment page.
    // Usually their own return to the page gets here first; this covers them
    // closing the tab before it loaded.
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "setup" || !session.setup_intent) break;
      const setupIntentId =
        typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id;
      const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
      await saveSetupIntent(supabase, si);
      break;
    }

    // A bank account verified by micro-deposits, days after it was added.
    case "setup_intent.succeeded": {
      const si = event.data.object as Stripe.SetupIntent;
      const full = await stripe.setupIntents.retrieve(si.id, { expand: ["payment_method"] });
      await saveSetupIntent(supabase, full);
      break;
    }

    // A bank debit settling — several days after the charge was started.
    case "payment_intent.succeeded": {
      await settleAutopay(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const splits = chargeSplits(pi);
      if (splits.length === 0) break;
      await failAutopay(supabase, {
        invoiceIds: splits.map((x) => x.invoiceId),
        paymentIntentId: pi.id,
        reason: pi.last_payment_error?.message ?? null,
        parentId: pi.metadata.parent_id,
      });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
