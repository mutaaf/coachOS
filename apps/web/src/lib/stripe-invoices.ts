/**
 * Creating Stripe invoices. Not a server action: the monthly run calls this
 * from the cron, which has no signed-in user. The guarded wrappers are in
 * lib/actions/stripe.ts.
 */
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getStripeClient, getStripeSettings } from "@/lib/stripe-client";
import { autopayPayersByStudent } from "@/lib/autopay";

export async function getOrCreateStripeCustomer(parentId: string) {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "Stripe is not enabled." };
  const { mode } = await getStripeSettings();

  const supabase = createAdminSupabase();

  const { data: parent, error: parentError } = await supabase
    .from("parents")
    .select("*")
    .eq("id", parentId)
    .single();

  if (parentError || !parent) return { error: "Parent not found." };

  // A customer only exists in the mode it was made in; after switching modes
  // the family gets a new one there.
  if (parent.stripe_customer_id && (parent.stripe_customer_mode ?? "test") === mode) {
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
    .update({ stripe_customer_id: customer.id, stripe_customer_mode: mode })
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
    .select("id, student_id")
    .eq("month", month)
    .eq("status", "pending")
    .is("stripe_invoice_id", null);

  if (!invoices || invoices.length === 0) return { created: 0 };

  // Autopay families are charged directly. A payable invoice beside that would
  // let them pay the same month twice.
  const autopay = await autopayPayersByStudent(supabase);

  let created = 0;
  for (const inv of invoices) {
    if (autopay.has(inv.student_id)) continue;
    const result = await createStripeInvoice(inv.id);
    if (!("error" in result)) created++;
  }

  revalidatePath("/payments");
  return { created };
}
