import type Stripe from "stripe";
import type { OpsClient } from "@/lib/supabase/types";
import { renderTemplate } from "shared";
import { businessToday } from "@/lib/dates";
import { payLink } from "@/lib/app-url";
import { recalculateInvoiceStatus, toCents } from "@/lib/invoice-status";

/**
 * Autopay: a parent saves a bank account or card once, and each invoice is
 * charged on its due date.
 *
 * Nothing here is a server action, on purpose. Every export of a "use server"
 * module can be called by anyone who loads a page, and these charge cards.
 * They are reached only from the cron, the Stripe webhook, and the parent's own
 * page after it has checked the token.
 */

export type AutopayMethod = "us_bank_account" | "card";

export interface AutopayParent {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  pay_token: string;
  stripe_customer_id: string | null;
  autopay_method: AutopayMethod;
  autopay_payment_method_id: string;
  autopay_enabled_at: string;
}

/** The card fee, in cents, on a balance in cents. Banks are never charged one. */
export function cardFeeCents(balanceCents: number, feePercent: number): number {
  if (!(feePercent > 0)) return 0;
  return Math.round((balanceCents * feePercent) / 100);
}

export async function getCardFeePercent(supabase: OpsClient): Promise<number> {
  const { data } = await supabase
    .from("config")
    .select("value")
    .eq("key", "card_fee_percent")
    .maybeSingle();
  const pct = Number(data?.value);
  return Number.isFinite(pct) && pct > 0 ? pct : 0;
}

/** "Visa ••••4242" or "Chase ••••6789" — enough to recognise, nothing more. */
export function describePaymentMethod(pm: Stripe.PaymentMethod): {
  method: AutopayMethod;
  label: string;
} | null {
  if (pm.type === "card" && pm.card) {
    const brand = pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1);
    return { method: "card", label: `${brand} ••••${pm.card.last4}` };
  }
  if (pm.type === "us_bank_account" && pm.us_bank_account) {
    const bank = pm.us_bank_account.bank_name || "Bank account";
    return { method: "us_bank_account", label: `${bank} ••••${pm.us_bank_account.last4}` };
  }
  return null;
}

/**
 * Save what a finished Stripe setup produced onto the parent.
 *
 * Called from the parent's return to their page and again from the webhook,
 * whichever comes first; it is safe to run twice. A bank account that could
 * not be verified instantly comes back needing micro-deposits, and is held as
 * 'pending' — with Stripe's verification page saved so the parent can find it
 * again — rather than being charged before anyone knows it is theirs.
 */
export async function saveSetupIntent(supabase: OpsClient, si: Stripe.SetupIntent) {
  const parentId = si.metadata?.parent_id;
  if (!parentId || !si.payment_method || typeof si.payment_method === "string") return;

  const described = describePaymentMethod(si.payment_method);
  if (!described) return;

  if (si.status === "succeeded") {
    await supabase
      .from("parents")
      .update({
        autopay_status: "active",
        autopay_method: described.method,
        autopay_payment_method_id: si.payment_method.id,
        autopay_label: described.label,
        autopay_verify_url: null,
        autopay_enabled_at: new Date().toISOString(),
      })
      .eq("id", parentId)
      // Redelivery of the same setup must not reset the date that decides
      // whether a failed charge is retried.
      .or(`autopay_payment_method_id.is.null,autopay_payment_method_id.neq.${si.payment_method.id},autopay_status.neq.active`);
    return;
  }

  if (si.status === "requires_action" && si.next_action?.type === "verify_with_microdeposits") {
    await supabase
      .from("parents")
      .update({
        autopay_status: "pending",
        autopay_method: described.method,
        autopay_payment_method_id: si.payment_method.id,
        autopay_label: described.label,
        autopay_verify_url: si.next_action.verify_with_microdeposits?.hosted_verification_url ?? null,
      })
      .eq("id", parentId);
  }
}

/** Students whose fees an autopay parent will cover, and which parent. */
export async function autopayPayersByStudent(
  supabase: OpsClient
): Promise<Map<string, AutopayParent>> {
  const { data: parents } = await supabase
    .from("parents")
    .select(
      "id, first_name, last_name, phone, pay_token, stripe_customer_id, autopay_method, autopay_payment_method_id, autopay_enabled_at"
    )
    .eq("autopay_status", "active");

  const byStudent = new Map<string, AutopayParent>();
  if (!parents || parents.length === 0) return byStudent;

  const { data: links } = await supabase
    .from("student_parents")
    .select("student_id, parent_id")
    .in(
      "parent_id",
      parents.map((p) => p.id)
    )
    // Stable, so when both parents have autopay the same one always pays.
    .order("parent_id");

  const byId = new Map(parents.map((p) => [p.id, p as AutopayParent]));
  for (const link of links || []) {
    if (!byStudent.has(link.student_id)) byStudent.set(link.student_id, byId.get(link.parent_id)!);
  }
  return byStudent;
}

async function queueMessage(
  supabase: OpsClient,
  parent: { first_name: string; last_name: string; phone: string | null },
  message: string
) {
  if (!parent.phone) return;
  await supabase.from("message_queue").insert({
    recipient_phone: parent.phone,
    recipient_name: `${parent.first_name} ${parent.last_name}`,
    message,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
  });
}

/** Stripe's wording, trimmed to fit in a sentence: "your card was declined". */
function shortReason(message: string | null | undefined): string {
  const text = (message || "the bank declined it").trim().replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Record a settled charge. Safe to call more than once for the same charge —
 * the card path settles on the spot and the webhook then reports it again.
 */
export async function settleAutopay(supabase: OpsClient, pi: Stripe.PaymentIntent) {
  const invoiceId = pi.metadata?.invoice_id;
  if (!invoiceId || pi.metadata?.source !== "autopay") return;

  const feeCents = Number(pi.metadata.fee_cents || 0);
  const receivedCents = (pi.amount_received || pi.amount) - feeCents;

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount: receivedCents / 100,
    fee: feeCents / 100,
    method: "stripe",
    reference: pi.metadata.label || "Autopay",
    notes: feeCents > 0 ? `Autopay (card fee $${(feeCents / 100).toFixed(2)})` : "Autopay",
    external_id: pi.id,
  });
  // 23505: this charge is already recorded. Anything else is a real failure.
  if (error && error.code !== "23505") throw new Error(error.message);

  await supabase
    .from("invoices")
    .update({ autopay_status: "succeeded", autopay_error: null, autopay_payment_intent_id: pi.id })
    .eq("id", invoiceId);
  await recalculateInvoiceStatus(supabase, invoiceId);
}

/**
 * A charge that did not go through: the invoice goes back to being owed, and
 * the parent hears about it once, with their link to fix it.
 */
export async function failAutopay(
  supabase: OpsClient,
  opts: { invoiceId: string; paymentIntentId: string | null; reason: string | null; parentId?: string }
) {
  // Only the call that flips it from processing sends the message. The card
  // path fails on the spot and Stripe's webhook then reports the same failure.
  const { data: flipped } = await supabase
    .from("invoices")
    .update({
      autopay_status: "failed",
      autopay_error: opts.reason,
      autopay_payment_intent_id: opts.paymentIntentId,
      status: "pending",
    })
    .eq("id", opts.invoiceId)
    .eq("autopay_status", "processing")
    .select("id, amount, students(first_name), programs(name)")
    .maybeSingle();

  if (!flipped) return;
  await recalculateInvoiceStatus(supabase, opts.invoiceId);

  if (!opts.parentId) return;
  const { data: parent } = await supabase
    .from("parents")
    .select("first_name, last_name, phone, pay_token")
    .eq("id", opts.parentId)
    .maybeSingle();
  if (!parent) return;

  const { data: template } = await supabase
    .from("message_templates")
    .select("body")
    .eq("name", "autopay_failed")
    .eq("is_active", true)
    .maybeSingle();

  const body =
    template?.body ||
    "Hi {{parent_name}}, the automatic payment of {{amount}} for {{student_name}}'s {{program_name}} didn't go through ({{reason}}). You can update your payment details here: {{pay_link}}";

  await queueMessage(
    supabase,
    parent,
    renderTemplate(body, {
      parent_name: parent.first_name,
      amount: `$${Number(flipped.amount).toFixed(2)}`,
      student_name: (flipped as any).students?.first_name ?? "",
      program_name: (flipped as any).programs?.name ?? "",
      reason: shortReason(opts.reason),
      pay_link: payLink(parent.pay_token),
    })
  );
}

export interface ChargeRunResult {
  paid: number;
  processing: number;
  failed: number;
  skipped: number;
}

/**
 * Charge every invoice that is due and has an autopay parent behind it.
 *
 * Run daily from the cron, so it also picks up a family who switches autopay on
 * mid-month: their open balance is charged the next day, which the page tells
 * them before they agree.
 */
export async function chargeDueAutopay(
  supabase: OpsClient,
  stripe: Stripe,
  today: string = businessToday()
): Promise<ChargeRunResult> {
  const result: ChargeRunResult = { paid: 0, processing: 0, failed: 0, skipped: 0 };

  const payers = await autopayPayersByStudent(supabase);
  if (payers.size === 0) return result;

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, amount, month, status, autopay_status, autopay_attempted_at, stripe_invoice_id, student_id, students(first_name, last_name), programs(name), payments(amount)"
    )
    .in("student_id", [...payers.keys()])
    .in("status", ["pending", "overdue"])
    .lte("due_date", today);

  const feePercent = await getCardFeePercent(supabase);

  for (const inv of (invoices || []) as any[]) {
    const payer = payers.get(inv.student_id)!;

    // A charge that failed waits for a new payment method. Retrying the same
    // declined card daily only collects decline fees and annoys the bank.
    if (
      inv.autopay_status === "failed" &&
      inv.autopay_attempted_at &&
      inv.autopay_attempted_at >= payer.autopay_enabled_at
    ) {
      result.skipped++;
      continue;
    }

    const paidCents = (inv.payments || []).reduce((s: number, p: any) => s + toCents(p.amount), 0);
    const balanceCents = toCents(inv.amount) - paidCents;
    if (balanceCents <= 0) {
      await recalculateInvoiceStatus(supabase, inv.id);
      result.skipped++;
      continue;
    }

    // Claim it. Two runs overlapping must not both charge, and the status
    // change is also what keeps the overdue sweep off it while a bank debit
    // takes its few days.
    const { data: claimed } = await supabase
      .from("invoices")
      .update({
        status: "processing",
        autopay_status: "processing",
        autopay_attempted_at: new Date().toISOString(),
        autopay_error: null,
      })
      .eq("id", inv.id)
      .in("status", ["pending", "overdue"])
      .select("id")
      .maybeSingle();

    if (!claimed) {
      result.skipped++;
      continue;
    }

    // A family on autopay must not also be able to pay a hosted Stripe invoice
    // for the same month and be charged twice.
    if (inv.stripe_invoice_id) {
      try {
        await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
      } catch {
        // Already void, or never finalised; either way it can no longer be paid.
      }
      await supabase
        .from("invoices")
        .update({ stripe_hosted_invoice_url: null })
        .eq("id", inv.id);
    }

    const feeCents = payer.autopay_method === "card" ? cardFeeCents(balanceCents, feePercent) : 0;
    const childName = `${inv.students?.first_name ?? ""}`.trim();

    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: balanceCents + feeCents,
          currency: "usd",
          customer: payer.stripe_customer_id ?? undefined,
          payment_method: payer.autopay_payment_method_id,
          payment_method_types: [payer.autopay_method],
          off_session: true,
          confirm: true,
          description: `${inv.programs?.name ?? "Program"} — ${childName} (${inv.month})`,
          metadata: {
            source: "autopay",
            invoice_id: inv.id,
            parent_id: payer.id,
            fee_cents: String(feeCents),
          },
        },
        // One charge per invoice per saved payment method, however many times
        // this runs — a network blip and a retry must not become two charges.
        { idempotencyKey: `autopay:${inv.id}:${payer.autopay_enabled_at}` }
      );
    } catch (err: any) {
      await failAutopay(supabase, {
        invoiceId: inv.id,
        paymentIntentId: err?.raw?.payment_intent?.id ?? err?.payment_intent?.id ?? null,
        reason: err?.message ?? null,
        parentId: payer.id,
      });
      result.failed++;
      continue;
    }

    await supabase
      .from("invoices")
      .update({ autopay_payment_intent_id: pi.id })
      .eq("id", inv.id);

    if (pi.status === "succeeded") {
      await settleAutopay(supabase, pi);
      result.paid++;
    } else if (pi.status === "processing") {
      // A bank debit. The webhook settles it in a few days.
      result.processing++;
    } else {
      // Most often a card that wants the cardholder to confirm, which cannot
      // happen with nobody there. Cancel it so it cannot be completed later
      // alongside whatever the parent does instead.
      try {
        await stripe.paymentIntents.cancel(pi.id);
      } catch {
        // Nothing to undo if it is already finished.
      }
      await failAutopay(supabase, {
        invoiceId: inv.id,
        paymentIntentId: pi.id,
        reason: "Your bank asked you to confirm the payment",
        parentId: payer.id,
      });
      result.failed++;
    }
  }

  return result;
}

/**
 * The parent is back from Stripe Checkout. Save what they set up without
 * waiting for the webhook, so the page they land on already says it worked.
 *
 * The session must belong to the parent whose page this is; a session id from
 * someone else's URL is ignored.
 */
export async function completeCheckoutSetup(
  supabase: OpsClient,
  stripe: Stripe,
  sessionId: string,
  parentId: string
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent.payment_method"],
  });
  if (session.metadata?.parent_id !== parentId) return;
  if (!session.setup_intent || typeof session.setup_intent === "string") return;
  await saveSetupIntent(supabase, session.setup_intent);
}
