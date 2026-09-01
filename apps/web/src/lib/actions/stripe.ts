"use server";

import Stripe from "stripe";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function getStripeClient(): Promise<Stripe | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("config")
    .select("key, value")
    .in("key", ["stripe_enabled", "stripe_secret_key"]);

  const config = Object.fromEntries((data || []).map((c) => [c.key, c.value]));

  if (config.stripe_enabled !== "true" || !config.stripe_secret_key) {
    return null;
  }

  return new Stripe(config.stripe_secret_key, { apiVersion: "2026-01-28.clover" });
}

export async function getOrCreateStripeCustomer(parentId: string) {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "Stripe is not enabled." };

  const supabase = createAdminSupabase();

  const { data: parent, error: parentError } = await supabase
    .from("parents")
    .select("*")
    .eq("id", parentId)
    .single();

  if (parentError || !parent) return { error: "Parent not found." };

  if (parent.stripe_customer_id) {
    return { customerId: parent.stripe_customer_id };
  }

  const customer = await stripe.customers.create({
    name: `${parent.first_name} ${parent.last_name}`,
    phone: parent.phone,
    email: parent.email || undefined,
    metadata: { parent_id: parentId },
  });

  await supabase
    .from("parents")
    .update({ stripe_customer_id: customer.id })
    .eq("id", parentId);

  return { customerId: customer.id };
}

export async function createStripeInvoice(invoiceId: string) {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "Stripe is not enabled." };

  const supabase = createAdminSupabase();

  const { data: invoice, error: invError } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*)")
    .eq("id", invoiceId)
    .single();

  if (invError || !invoice) return { error: "Invoice not found." };

  if (invoice.stripe_invoice_id) {
    return { error: "Stripe invoice already exists for this invoice." };
  }

  const parent = invoice.parents as any;
  const student = invoice.students as any;
  const program = invoice.programs as any;

  // Ensure Stripe customer exists
  const customerResult = await getOrCreateStripeCustomer(parent.id);
  if ("error" in customerResult) return customerResult;

  const stripeInvoice = await stripe.invoices.create({
    customer: customerResult.customerId,
    collection_method: "send_invoice",
    days_until_due: 7,
    metadata: { invoice_id: invoiceId },
  });

  await stripe.invoiceItems.create({
    invoice: stripeInvoice.id,
    customer: customerResult.customerId,
    amount: Math.round(Number(invoice.amount) * 100),
    currency: "usd",
    description: `${program?.name} — ${student?.first_name} ${student?.last_name} (${invoice.month})`,
  });

  const finalizedInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id);

  await supabase
    .from("invoices")
    .update({
      stripe_invoice_id: finalizedInvoice.id,
      stripe_hosted_invoice_url: finalizedInvoice.hosted_invoice_url,
    })
    .eq("id", invoiceId);

  revalidatePath("/payments");
  return {
    stripeInvoiceId: finalizedInvoice.id,
    paymentUrl: finalizedInvoice.hosted_invoice_url,
  };
}

export async function createStripeInvoicesForMonth(month: string) {
  const supabase = createAdminSupabase();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("month", month)
    .eq("status", "pending")
    .is("stripe_invoice_id", null);

  if (!invoices || invoices.length === 0) return { created: 0 };

  let created = 0;
  for (const inv of invoices) {
    const result = await createStripeInvoice(inv.id);
    if (!("error" in result)) created++;
  }

  revalidatePath("/payments");
  return { created };
}

export async function sendStripePaymentLink(invoiceId: string) {
  const supabase = createAdminSupabase();

  const { data: invoice, error: invError } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*)")
    .eq("id", invoiceId)
    .single();

  if (invError || !invoice) return { error: "Invoice not found." };
  if (!invoice.stripe_hosted_invoice_url) {
    return { error: "No Stripe payment link available. Create a Stripe invoice first." };
  }

  const parent = invoice.parents as any;
  const student = invoice.students as any;
  const program = invoice.programs as any;

  if (!parent?.phone) return { error: "Parent has no phone number." };

  const message = `Hi ${parent.first_name}, here's the payment link for ${student?.first_name}'s ${program?.name} (${invoice.month}) — $${invoice.amount}: ${invoice.stripe_hosted_invoice_url}`;

  const { error: queueError } = await supabase.from("message_queue").insert({
    recipient_phone: parent.phone,
    recipient_name: `${parent.first_name} ${parent.last_name}`,
    message,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
  });

  if (queueError) return { error: "Failed to queue message." };

  revalidatePath("/payments");
  revalidatePath("/messaging");
  return { success: true };
}
