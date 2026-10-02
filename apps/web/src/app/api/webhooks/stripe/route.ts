import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripeSettings, stripeFor, type StripeMode } from "@/lib/stripe-client";
import { recalculateInvoiceStatus } from "@/lib/invoice-status";
import { emailReceipt } from "@/lib/parent-emails";
import { chargeSplits, failAutopay, saveSetupIntent, settleAutopay } from "@/lib/autopay";

/**
 * Stripe sends test-mode and live-mode events to the same address, each signed
 * with its own mode's webhook secret. Whichever secret verifies the signature
 * says which mode the event is from, and that mode's key is used to look
 * anything up — a test event must never be acted on with live keys.
 */
export async function POST(request: NextRequest) {
  const settings = await getStripeSettings();
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event | null = null;
  let mode: StripeMode | null = null;
  for (const m of ["live", "test"] as const) {
    const { secret, webhook } = settings.keys[m];
    if (!secret || !webhook) continue;
    try {
      event = stripeFor(secret).webhooks.constructEvent(body, signature, webhook);
      mode = m;
      break;
    } catch {
      // Not this mode's signature; try the other.
    }
  }

  if (!event || !mode) {
    console.error("Stripe webhook signature did not verify for either mode");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const stripe = stripeFor(settings.keys[mode].secret);
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
      const { data: paid } = await supabase
        .from("payments")
        .select("id")
        .eq("external_id", stripeInvoice.id);
      await emailReceipt(supabase, {
        paymentIds: (paid || []).map((p) => p.id),
        parentId: null,
        method: "card",
        dedupeKey: `receipt:${stripeInvoice.id}`,
      });
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
