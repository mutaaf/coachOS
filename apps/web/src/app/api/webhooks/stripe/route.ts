import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";

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

  const stripe = new Stripe(config.stripe_secret_key, { apiVersion: "2026-01-28.clover" });
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

  if (event.type === "invoice.paid") {
    const stripeInvoice = event.data.object as Stripe.Invoice;
    const invoiceId = stripeInvoice.metadata?.invoice_id;

    if (invoiceId) {
      // Record the payment
      await supabase.from("payments").insert({
        invoice_id: invoiceId,
        amount: (stripeInvoice.amount_paid || 0) / 100,
        method: "stripe",
        reference: stripeInvoice.id,
        notes: "Paid via Stripe",
      });

      // Mark invoice as paid
      await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", invoiceId);
    }
  }

  if (event.type === "invoice.payment_failed") {
    const stripeInvoice = event.data.object as Stripe.Invoice;
    const invoiceId = stripeInvoice.metadata?.invoice_id;

    if (invoiceId) {
      await supabase
        .from("invoices")
        .update({ status: "overdue" })
        .eq("id", invoiceId);
    }
  }

  return NextResponse.json({ received: true });
}
