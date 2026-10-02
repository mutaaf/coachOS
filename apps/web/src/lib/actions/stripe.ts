"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getStripeClient, getStripeSettings } from "@/lib/stripe-client";
import { autopayPayersByStudent } from "@/lib/autopay";

import * as invoices from "@/lib/stripe-invoices";

export async function getOrCreateStripeCustomer(parentId: string) {
  await requireSignedIn();
  return invoices.getOrCreateStripeCustomer(parentId);
}

export async function createStripeInvoice(invoiceId: string) {
  await requireSignedIn();
  return invoices.createStripeInvoice(invoiceId);
}

export async function createStripeInvoicesForMonth(month: string) {
  await requireSignedIn();
  return invoices.createStripeInvoicesForMonth(month);
}

export async function sendStripePaymentLink(invoiceId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
