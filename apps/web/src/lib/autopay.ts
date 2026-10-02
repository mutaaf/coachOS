import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { OpsClient } from "@/lib/supabase/types";
import { renderTemplate } from "shared";
import { businessToday } from "@/lib/dates";
import { payLink } from "@/lib/app-url";
import { recalculateInvoiceStatus, toCents } from "@/lib/invoice-status";
import { emailPaymentFailed, emailReceipt } from "@/lib/parent-emails";

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
 * What one charge paid for: each invoice, its balance, and its share of the
 * card fee. Carried in the PaymentIntent's metadata so the webhook, days later
 * for a bank debit, can book it without looking anything up.
 */
export interface ChargeSplit {
  invoiceId: string;
  cents: number;
  feeCents: number;
}

function encodeSplits(splits: ChargeSplit[]) {
  return {
    invoice_ids: splits.map((s) => s.invoiceId).join(","),
    balances: splits.map((s) => s.cents).join(","),
    fees: splits.map((s) => s.feeCents).join(","),
  };
}

export function chargeSplits(pi: Stripe.PaymentIntent): ChargeSplit[] {
  const m = pi.metadata ?? {};
  if (m.source !== "autopay") return [];
  if (m.invoice_ids) {
    const ids = m.invoice_ids.split(",");
    const balances = (m.balances ?? "").split(",").map(Number);
    const fees = (m.fees ?? "").split(",").map(Number);
    return ids.map((invoiceId, i) => ({ invoiceId, cents: balances[i] || 0, feeCents: fees[i] || 0 }));
  }
  // Charges started before charges were combined carried a single invoice.
  if (m.invoice_id) {
    const feeCents = Number(m.fee_cents || 0);
    return [{ invoiceId: m.invoice_id, cents: (pi.amount_received || pi.amount) - feeCents, feeCents }];
  }
  return [];
}

/**
 * Record a settled charge against every invoice it covered. Safe to call more
 * than once for the same charge — the card path settles on the spot and the
 * webhook then reports it again.
 */
export async function settleAutopay(supabase: OpsClient, pi: Stripe.PaymentIntent) {
  for (const split of chargeSplits(pi)) {
    const { error } = await supabase.from("payments").insert({
      invoice_id: split.invoiceId,
      amount: split.cents / 100,
      fee: split.feeCents / 100,
      method: "stripe",
      reference: pi.metadata.label || "Autopay",
      notes: split.feeCents > 0 ? `Autopay (card fee $${(split.feeCents / 100).toFixed(2)})` : "Autopay",
      // One charge, several invoices: each payment row is the charge's share of
      // one invoice, and is unique as such.
      external_id: `${pi.id}:${split.invoiceId}`,
    });
    // 23505: this share is already recorded. Anything else is a real failure.
    if (error && error.code !== "23505") throw new Error(error.message);

    await supabase
      .from("invoices")
      .update({ autopay_status: "succeeded", autopay_error: null, autopay_payment_intent_id: pi.id })
      .eq("id", split.invoiceId);
    await recalculateInvoiceStatus(supabase, split.invoiceId);
  }

  // One receipt for the charge, however many invoices it covered and however
  // many times this runs for it.
  const splits = chargeSplits(pi);
  if (splits.length) {
    const { data: rows } = await supabase
      .from("payments")
      .select("id")
      .in(
        "external_id",
        splits.map((x) => `${pi.id}:${x.invoiceId}`)
      );
    await emailReceipt(supabase, {
      paymentIds: (rows || []).map((r) => r.id),
      parentId: pi.metadata?.parent_id ?? null,
      dedupeKey: `receipt:${pi.id}`,
    });
  }
}

function listNames(names: string[]) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * A charge that did not go through: its invoices go back to being owed, and
 * the parent hears about it once — one message for the family, not one per
 * child — with their link to fix it.
 */
export async function failAutopay(
  supabase: OpsClient,
  opts: { invoiceIds: string[]; paymentIntentId: string | null; reason: string | null; parentId?: string }
) {
  // Only the call that flips them from processing sends the message. The card
  // path fails on the spot and Stripe's webhook then reports the same failure.
  const { data: flipped } = await supabase
    .from("invoices")
    .update({
      autopay_status: "failed",
      autopay_error: opts.reason,
      autopay_payment_intent_id: opts.paymentIntentId,
      status: "pending",
    })
    .in("id", opts.invoiceIds)
    .eq("autopay_status", "processing")
    .select("id, amount, payments(amount), students(first_name), programs(name)");

  if (!flipped || flipped.length === 0) return;
  for (const inv of flipped) await recalculateInvoiceStatus(supabase, inv.id);

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

  const owedCents = (flipped as any[]).reduce(
    (sum, inv) =>
      sum + toCents(inv.amount) - (inv.payments || []).reduce((s: number, p: any) => s + toCents(p.amount), 0),
    0
  );

  await queueMessage(
    supabase,
    parent,
    renderTemplate(body, {
      parent_name: parent.first_name,
      amount: `$${(owedCents / 100).toFixed(2)}`,
      student_name: listNames((flipped as any[]).map((i) => i.students?.first_name)),
      program_name: listNames((flipped as any[]).map((i) => i.programs?.name)),
      reason: shortReason(opts.reason),
      pay_link: payLink(parent.pay_token),
    })
  );

  await emailPaymentFailed(supabase, {
    parentId: opts.parentId,
    childNames: listNames((flipped as any[]).map((i) => i.students?.first_name)),
    owedCents,
    reason: shortReason(opts.reason),
    dedupeKey: `failed:${opts.paymentIntentId ?? [...opts.invoiceIds].sort().join(",")}`,
  });
}

export interface ChargeRunResult {
  /** Families whose charge went through on the spot. */
  paid: number;
  /** Families whose bank debit has started and will settle by webhook. */
  processing: number;
  failed: number;
  /** Invoices passed over: waiting for a new card, already paid, or claimed by another run. */
  skipped: number;
}

/**
 * Charge every family whose invoices are due, once each.
 *
 * A family's due invoices — two children, or this month and an unpaid last
 * month — go into a single charge, so the parent sees one line on their
 * statement and, if it fails, gets one message.
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
      "id, amount, month, status, autopay_status, autopay_attempted_at, stripe_invoice_id, student_id, created_at, students(first_name, last_name), programs(name), payments(amount)"
    )
    .in("student_id", [...payers.keys()])
    .in("status", ["pending", "overdue"])
    .lte("due_date", today)
    .order("due_date")
    .order("created_at");

  const feePercent = await getCardFeePercent(supabase);

  // Group what is due by the parent who pays it.
  const families = new Map<string, { payer: AutopayParent; invoices: any[] }>();
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
    inv.balanceCents = toCents(inv.amount) - paidCents;
    if (inv.balanceCents <= 0) {
      await recalculateInvoiceStatus(supabase, inv.id);
      result.skipped++;
      continue;
    }

    const family = families.get(payer.id) ?? { payer, invoices: [] };
    family.invoices.push(inv);
    families.set(payer.id, family);
  }

  for (const { payer, invoices: due } of families.values()) {
    // Claim them. Two runs overlapping must not both charge, and the status
    // change is also what keeps the overdue sweep off them while a bank debit
    // takes its few days.
    const { data: claimedRows } = await supabase
      .from("invoices")
      .update({
        status: "processing",
        autopay_status: "processing",
        autopay_attempted_at: new Date().toISOString(),
        autopay_error: null,
      })
      .in(
        "id",
        due.map((i) => i.id)
      )
      .in("status", ["pending", "overdue"])
      .select("id");

    const claimedIds = new Set((claimedRows || []).map((r) => r.id));
    const claimed = due.filter((i) => claimedIds.has(i.id));
    result.skipped += due.length - claimed.length;
    if (claimed.length === 0) continue;

    // A family on autopay must not also be able to pay a hosted Stripe invoice
    // for the same month and be charged twice.
    for (const inv of claimed.filter((i) => i.stripe_invoice_id)) {
      try {
        await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
      } catch {
        // Already void, or never finalised; either way it can no longer be paid.
      }
      await supabase.from("invoices").update({ stripe_hosted_invoice_url: null }).eq("id", inv.id);
    }

    const splits: ChargeSplit[] = claimed.map((inv) => ({
      invoiceId: inv.id,
      cents: inv.balanceCents,
      feeCents: payer.autopay_method === "card" ? cardFeeCents(inv.balanceCents, feePercent) : 0,
    }));
    const total = splits.reduce((s, x) => s + x.cents + x.feeCents, 0);
    const ids = claimed.map((i) => i.id);

    const months = listNames(
      [...new Set(claimed.map((i) => i.month as string))].map((m) =>
        new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long" })
      )
    );
    const children = listNames(claimed.map((i) => i.students?.first_name));

    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: total,
          currency: "usd",
          customer: payer.stripe_customer_id ?? undefined,
          payment_method: payer.autopay_payment_method_id,
          payment_method_types: [payer.autopay_method],
          off_session: true,
          confirm: true,
          description: `${months} — ${children}`,
          metadata: { source: "autopay", parent_id: payer.id, ...encodeSplits(splits) },
        },
        // One charge per set of invoices per saved payment method, however many
        // times this runs — a network blip and a retry must not become two
        // charges. Hashed: Stripe caps keys at 255 characters.
        {
          idempotencyKey: `autopay:${createHash("sha256")
            .update(`${payer.id}|${[...ids].sort().join(",")}|${payer.autopay_enabled_at}`)
            .digest("hex")}`,
        }
      );
    } catch (err: any) {
      await failAutopay(supabase, {
        invoiceIds: ids,
        paymentIntentId: err?.raw?.payment_intent?.id ?? err?.payment_intent?.id ?? null,
        reason: err?.message ?? null,
        parentId: payer.id,
      });
      result.failed++;
      continue;
    }

    await supabase.from("invoices").update({ autopay_payment_intent_id: pi.id }).in("id", ids);

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
        invoiceIds: ids,
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
