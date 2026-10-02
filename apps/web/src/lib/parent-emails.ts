import type { OpsClient } from "@/lib/supabase/types";
import { sendEmail } from "@/lib/email";
import { inviteEmail, paymentFailedEmail, receiptEmail, reminderEmail, type EmailLine } from "@/lib/email-templates";
import { payLink } from "@/lib/app-url";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { toCents } from "@/lib/invoice-status";

/**
 * What each money event emails, and to whom. Each function takes the event's
 * own id as its dedupe key, so calling it twice for one event — a redelivered
 * webhook, the card path and the webhook both settling — sends one email.
 *
 * Families without an email on file are skipped silently; the Outbox and the
 * payment page still reach them.
 */

/** The name parents know the business by, from Settings. */
async function brand(supabase: OpsClient): Promise<string> {
  const { data } = await supabase.from("config").select("value").eq("key", "business_name").maybeSingle();
  return data?.value?.trim() || "Rising Stars Youth Academy";
}

async function parentFor(supabase: OpsClient, parentId: string) {
  const { data } = await supabase
    .from("parents")
    .select("id, first_name, email, pay_token, autopay_label")
    .eq("id", parentId)
    .maybeSingle();
  return data;
}

function onDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const METHOD_NAMES: Record<string, string> = { cash: "cash", zelle: "Zelle", venmo: "Venmo", stripe: "card" };

/**
 * A receipt for one or more payment rows that arrived together — one autopay
 * charge across two children is one receipt, not two.
 */
export async function emailReceipt(
  supabase: OpsClient,
  opts: { paymentIds: string[]; parentId: string | null; dedupeKey: string; method?: string }
) {
  if (opts.paymentIds.length === 0) return;
  const { data: payments } = await supabase
    .from("payments")
    .select("amount, fee, method, received_at, invoices(parent_id, month, students(first_name), programs(name))")
    .in("id", opts.paymentIds);
  if (!payments || payments.length === 0) return;

  const parentId = opts.parentId ?? (payments[0] as any).invoices?.parent_id;
  if (!parentId) return;
  const parent = await parentFor(supabase, parentId);
  if (!parent?.email) return;

  const lines: EmailLine[] = (payments as any[]).map((p) => ({
    childName: p.invoices?.students?.first_name ?? "",
    programName: p.invoices?.programs?.name ?? "",
    month: p.invoices?.month ?? "",
    cents: toCents(p.amount),
  }));
  const feeCents = (payments as any[]).reduce((s, p) => s + toCents(p.fee ?? 0), 0);
  const method =
    opts.method ??
    (payments[0].method === "stripe" && parent.autopay_label
      ? parent.autopay_label
      : METHOD_NAMES[payments[0].method] ?? payments[0].method);

  const content = receiptEmail({
    brand: await brand(supabase),
    parentName: parent.first_name,
    lines,
    feeCents,
    method,
    receivedOn: onDate(payments[0].received_at),
    payLink: payLink(parent.pay_token),
  });
  await sendEmail(supabase, {
    kind: "receipt",
    dedupeKey: opts.dedupeKey,
    parentId,
    to: parent.email,
    ...content,
  });
}

export async function emailPaymentFailed(
  supabase: OpsClient,
  opts: { parentId: string; childNames: string; owedCents: number; reason: string; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "payment_failed",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...paymentFailedEmail({
      brand: await brand(supabase),
      parentName: parent.first_name,
      childNames: opts.childNames,
      owedCents: opts.owedCents,
      reason: opts.reason,
      payLink: payLink(parent.pay_token),
    }),
  });
}

export async function emailInvite(
  supabase: OpsClient,
  opts: { parentId: string; childNames: string; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "invite",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...inviteEmail({ brand: await brand(supabase), parentName: parent.first_name, childNames: opts.childNames, payLink: payLink(parent.pay_token) }),
  });
}

export async function emailReminder(
  supabase: OpsClient,
  opts: { parentId: string; lines: EmailLine[]; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "reminder",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...reminderEmail({ brand: await brand(supabase), parentName: parent.first_name, lines: opts.lines, payLink: payLink(parent.pay_token) }),
  });
}
