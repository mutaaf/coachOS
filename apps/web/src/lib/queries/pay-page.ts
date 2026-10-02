import { createAdminSupabase } from "@/lib/supabase/server";
import { openInvoicesForFamily, toCents } from "@/lib/invoice-status";
import type { AutopayMethod } from "@/lib/autopay";

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
  };
  childNames: string[];
  open: PayPageLine[];
  processing: PayPageLine[];
  openCents: number;
  monthlyCents: number;
  stripeEnabled: boolean;
  cardFeePercent: number;
  zelleRecipient: string | null;
  businessName: string;
  zelleNames: string[];
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
    .select("id, first_name, autopay_status, autopay_method, autopay_label, autopay_verify_url")
    .eq("pay_token", token)
    .maybeSingle();
  if (!parent) return null;

  const { data: links } = await supabase
    .from("student_parents")
    .select("student_id, students(first_name, enrollments(status, programs(monthly_fee)))")
    .eq("parent_id", parent.id);

  const childNames: string[] = [];
  let monthlyCents = 0;
  const studentIds: string[] = [];
  for (const link of (links || []) as any[]) {
    studentIds.push(link.student_id);
    const active = (link.students?.enrollments || []).filter((e: any) => e.status === "active");
    if (active.length > 0) childNames.push(link.students.first_name);
    for (const e of active) monthlyCents += toCents(e.programs?.monthly_fee ?? 0);
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

  const { data: config } = await supabase
    .from("config")
    .select("key, value")
    .in("key", [
      "stripe_enabled",
      "stripe_secret_key",
      "card_fee_percent",
      "zelle_recipient",
      "business_name",
    ]);
  const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));

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
    },
    childNames,
    open,
    processing,
    openCents: open.reduce((s, l) => s + l.balanceCents, 0),
    monthlyCents,
    stripeEnabled: c.stripe_enabled === "true" && !!c.stripe_secret_key,
    cardFeePercent: Number(c.card_fee_percent) > 0 ? Number(c.card_fee_percent) : 0,
    zelleRecipient: c.zelle_recipient?.trim() || null,
    businessName:
      c.business_name && c.business_name !== "CoachOS" ? c.business_name : "Rising Stars Youth Academy",
    zelleNames: (senders || []).map((s) =>
      s.sender_key.replace(/\b[a-z]/g, (ch: string) => ch.toUpperCase())
    ),
  };
}
