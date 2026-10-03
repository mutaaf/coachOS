import { getStripeSettings, stripeReady } from "@/lib/stripe-client";
import { createAdminSupabase } from "@/lib/supabase/server";
import { businessMonth, businessToday } from "@/lib/dates";

export async function getInvoices(filters?: {
  status?: string;
  month?: string;
  parentId?: string;
}) {
  const supabase = createAdminSupabase();
  let query = supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*)")
    .order("due_date", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.month) query = query.eq("month", filters.month);
  if (filters?.parentId) query = query.eq("parent_id", filters.parentId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getInvoice(id: string) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*), payments(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getPayments(filters?: {
  method?: string;
  startDate?: string;
  endDate?: string;
}) {
  const supabase = createAdminSupabase();
  let query = supabase
    .from("payments")
    .select("*, invoices(*, parents(*), students(*), programs(*))")
    .order("received_at", { ascending: false });

  if (filters?.method) query = query.eq("method", filters.method);
  if (filters?.startDate) query = query.gte("received_at", filters.startDate);
  if (filters?.endDate) query = query.lte("received_at", filters.endDate);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * The four cards on the Payments page.
 *
 * Pending and Overdue are what is still owed — a $100 invoice with $40 paid
 * counts $60, not $100. "This month" is the month in Central time: on the last
 * evening of a month it is still that month, whatever the server's clock says.
 */
export async function getPaymentSummary() {
  const supabase = createAdminSupabase();
  const currentMonth = businessMonth();

  const [invoicesRes, paymentsRes] = await Promise.all([
    supabase.from("invoices").select("amount, status, payments(amount)"),
    supabase.from("payments").select("amount, received_at"),
  ]);

  const owed = (i: any) =>
    Number(i.amount) - (i.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const invoices = (invoicesRes.data || []) as any[];

  const totalRevenue = (paymentsRes.data || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingAmount = invoices
    .filter((i) => i.status === "pending" || i.status === "processing")
    .reduce((sum, i) => sum + owed(i), 0);
  const overdue = invoices.filter((i) => i.status === "overdue");
  const overdueAmount = overdue.reduce((sum, i) => sum + owed(i), 0);
  const paidThisMonth = (paymentsRes.data || [])
    .filter((p) => businessMonth(new Date(p.received_at)) === currentMonth)
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return { totalRevenue, pendingAmount, overdueAmount, overdueCount: overdue.length, paidThisMonth };
}

/**
 * The dashboard's Overdue Payments tile and its alerts list. The count and the
 * money still owed cover every overdue invoice; only the preview stops at five,
 * oldest first. Counting the preview once told her 5 when 21 were overdue.
 */
export async function getOverdueSummary() {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, amount, due_date, students(first_name, last_name), payments(amount)")
    .eq("status", "overdue")
    .order("due_date", { ascending: true });
  if (error) throw error;

  const invoices = (data || []) as any[];
  const owed = (i: any) =>
    Number(i.amount) - (i.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);

  return {
    count: invoices.length,
    amount: invoices.reduce((sum, i) => sum + owed(i), 0),
    preview: invoices.slice(0, 5),
  };
}

export async function getOverdueInvoices() {
  const supabase = createAdminSupabase();
  const today = businessToday();

  await supabase
    .from("invoices")
    .update({ status: "overdue" })
    .eq("status", "pending")
    .lt("due_date", today);

  const { data, error } = await supabase
    .from("invoices")
    .select("*, parents(*), students(*), programs(*)")
    .eq("status", "overdue")
    .order("due_date");

  if (error) throw error;
  return data || [];
}

/**
 * Zelle emails waiting on the owner, and the most recent ones that matched by
 * themselves — shown so she can see it working, and undo one that is wrong.
 */
export async function getZelleInbox() {
  const supabase = createAdminSupabase();
  const [needsLook, recent, everReceived, lastSeen] = await Promise.all([
    supabase
      .from("zelle_receipts")
      .select("*, parents(id, first_name, last_name)")
      .in("status", ["unmatched", "unreadable"])
      .order("received_at", { ascending: false }),
    supabase
      .from("zelle_receipts")
      .select("*, parents(id, first_name, last_name)")
      .eq("status", "matched")
      .order("received_at", { ascending: false })
      .limit(8),
    supabase.from("zelle_receipts").select("id", { count: "exact", head: true }),
    supabase.from("config").select("value").eq("key", "zelle_script_last_seen").maybeSingle(),
  ]);
  return {
    needsLook: needsLook.data || [],
    recent: recent.data || [],
    connected: (everReceived.count ?? 0) > 0 || !!lastSeen.data?.value,
    /** When the Gmail script last checked in, if it ever has. */
    lastSeen: (lastSeen.data?.value as string) || null,
  };
}

export async function getAutopaySummary() {
  const supabase = createAdminSupabase();
  const stripe = await getStripeSettings();
  const [{ count: active }, { data: config }] = await Promise.all([
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("autopay_status", "active"),
    supabase
      .from("config")
      .select("key, value")
      .in("key", [
        "zelle_inbound_secret",
        "zelle_recipient",
        "zelle_alerts_inbox",
        "zelle_alerts_forward_from",
      ]),
  ]);
  const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));
  return {
    activeCount: active ?? 0,
    stripeEnabled: stripeReady(stripe),
    stripeMode: stripe.mode,
    zelleSecret: (c.zelle_inbound_secret as string) || "",
    zelleRecipient: (c.zelle_recipient as string) || "",
    zelleInbox: (c.zelle_alerts_inbox as string) || "",
    zelleForwardFrom: (c.zelle_alerts_forward_from as string) || "",
  };
}
