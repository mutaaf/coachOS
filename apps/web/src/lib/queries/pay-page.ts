import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripeSettings, stripeReady } from "@/lib/stripe-client";
import { openInvoicesForFamily, toCents } from "@/lib/invoice-status";
import type { AutopayMethod } from "@/lib/autopay";
import { readDueDay } from "@/lib/invoices";
import { familyCreditCents } from "@/lib/family-credit";

export function maskEmail(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const [user, domain] = email.trim().split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
}

function friendlyReason(error: string | null): string {
  const text = (error || "the bank declined it").trim().replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Tokens are 24 URL-safe characters; anything else is not worth a query. */
export function isPayToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(token);
}

export interface PayPageLine {
  id: string;
  childName: string;
  programName: string;
  month: string;
  dueDate: string;
  balanceCents: number;
  overdue: boolean;
}

export interface PayPageData {
  parent: {
    id: string;
    firstName: string;
    autopayStatus: "off" | "pending" | "active";
    autopayMethod: AutopayMethod | null;
    autopayLabel: string | null;
    autopayVerifyUrl: string | null;
    /** Masked — "r•••@gmail.com" — since the page is shared by link. */
    emailHint: string | null;
  };
  childNames: string[];
  open: PayPageLine[];
  processing: PayPageLine[];
  openCents: number;
  /** Paid ahead or over: goes on their next invoice. */
  creditCents: number;
  stripeEnabled: boolean;
  /** Stripe is in its sandbox: say so on the page, so nobody mistakes a test for a charge. */
  testMode: boolean;
  cardFeePercent: number;
  zelleRecipient: string | null;
  /** The day of the month each month's fee falls due, from Settings. */
  dueDay: number;
  businessName: string;
  zelleNames: string[];
  /** Set when an automatic payment failed and is waiting for a new card or account. */
  autopayFailed: { reason: string } | null;
}

/**
 * Everything a family's payment page shows, found by the token in its URL.
 *
 * Deliberately narrow: first names, programs, months and amounts. No last
 * names, phone numbers, medical notes or anyone else's family — the link gets
 * forwarded and screenshotted, and should be harmless when it is.
 */
export async function getPayPage(token: string): Promise<PayPageData | null> {
  if (!isPayToken(token)) return null;
  const supabase = createAdminSupabase();

  const { data: parent } = await supabase
    .from("parents")
    .select("id, first_name, email, autopay_status, autopay_method, autopay_label, autopay_verify_url")
    .eq("pay_token", token)
    .maybeSingle();
  if (!parent) return null;

  const { data: links } = await supabase
    .from("student_parents")
    .select("student_id, students(first_name, enrollments(status))")
    .eq("parent_id", parent.id);

  const childNames: string[] = [];
  const studentIds: string[] = [];
  for (const link of (links || []) as any[]) {
    studentIds.push(link.student_id);
    const active = (link.students?.enrollments || []).filter((e: any) => e.status === "active");
    if (active.length > 0) childNames.push(link.students.first_name);
  }

  const toLine = (inv: any, balanceCents: number): PayPageLine => ({
    id: inv.id,
    childName: inv.students?.first_name ?? "",
    programName: inv.programs?.name ?? "",
    month: inv.month,
    dueDate: inv.due_date,
    balanceCents,
    overdue: inv.status === "overdue",
  });

  const open = (await openInvoicesForFamily(supabase, parent.id)).map((inv) =>
    toLine(inv, inv.balanceCents)
  );

  const { data: inFlight } = studentIds.length
    ? await supabase
        .from("invoices")
        .select("id, month, due_date, amount, status, students(first_name), programs(name)")
        .in("student_id", studentIds)
        .eq("status", "processing")
    : { data: [] };
  const processing = (inFlight || []).map((inv: any) => toLine(inv, toCents(inv.amount)));

  const stripe = await getStripeSettings();
  const { data: config } = await supabase
    .from("config")
    .select("key, value")
    .in("key", [
      "card_fee_percent",
      "zelle_recipient",
      "business_name",
      "payment_due_day",
    ]);
  const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));

  const { data: failed } = studentIds.length
    ? await supabase
        .from("invoices")
        .select("autopay_error")
        .in("student_id", studentIds)
        .in("status", ["pending", "overdue"])
        .eq("autopay_status", "failed")
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { data: senders } = await supabase
    .from("zelle_senders")
    .select("sender_key")
    .eq("parent_id", parent.id);

  return {
    parent: {
      id: parent.id,
      firstName: parent.first_name,
      autopayStatus: parent.autopay_status,
      autopayMethod: parent.autopay_method,
      autopayLabel: parent.autopay_label,
      autopayVerifyUrl: parent.autopay_verify_url,
      emailHint: maskEmail(parent.email),
    },
    childNames,
    open,
    processing,
    openCents: open.reduce((s, l) => s + l.balanceCents, 0),
    creditCents: Math.max(await familyCreditCents(supabase, parent.id), 0),
    stripeEnabled: stripeReady(stripe),
    testMode: stripe.mode === "test",
    cardFeePercent: Number(c.card_fee_percent) > 0 ? Number(c.card_fee_percent) : 0,
    zelleRecipient: c.zelle_recipient?.trim() || null,
    dueDay: readDueDay(c.payment_due_day),
    businessName:
      c.business_name && c.business_name !== "CoachOS" ? c.business_name : "Rising Stars Youth Academy",
    // First name and an initial: enough for the family to recognise, not a
    // full name travelling with every forwarded link.
    zelleNames: (senders || []).map((s) => {
      const parts = s.sender_key.split(" ");
      const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
      return parts.length > 1 ? `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : cap(parts[0]);
    }),
    autopayFailed: failed ? { reason: friendlyReason(failed.autopay_error) } : null,
  };
}
