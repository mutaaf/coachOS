import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";

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

export async function getPaymentSummary() {
  const supabase = createAdminSupabase();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [invoicesRes, paymentsRes, overdueRes, monthPayRes] = await Promise.all([
    supabase.from("invoices").select("amount, status"),
    supabase.from("payments").select("amount"),
    supabase.from("invoices").select("amount").eq("status", "overdue"),
    supabase
      .from("payments")
      .select("amount")
      .gte("received_at", `${currentMonth}-01`),
  ]);

  const totalRevenue = (paymentsRes.data || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingAmount = (invoicesRes.data || [])
    // A bank debit on its way is still money not yet in hand.
    .filter((i) => i.status === "pending" || i.status === "processing")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueAmount = (overdueRes.data || []).reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueCount = overdueRes.data?.length || 0;
  const paidThisMonth = (monthPayRes.data || []).reduce((sum, p) => sum + Number(p.amount), 0);

  return { totalRevenue, pendingAmount, overdueAmount, overdueCount, paidThisMonth };
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
  const [needsLook, recent, everReceived] = await Promise.all([
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
  ]);
  return {
    needsLook: needsLook.data || [],
    recent: recent.data || [],
    connected: (everReceived.count ?? 0) > 0,
  };
}

/** Everyone the owner might say a Zelle payment came from. */
export async function getParentsForMatching() {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("parents")
    .select("id, first_name, last_name, student_parents(students(first_name))")
    .order("first_name");
  return (data || []).map((p: any) => ({
    id: p.id as string,
    label: `${p.first_name} ${p.last_name}${
      p.student_parents?.length
        ? ` (${p.student_parents.map((sp: any) => sp.students?.first_name).filter(Boolean).join(", ")})`
        : ""
    }`,
  }));
}

export async function getAutopaySummary() {
  const supabase = createAdminSupabase();
  const [{ count: active }, { data: config }] = await Promise.all([
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("autopay_status", "active"),
    supabase
      .from("config")
      .select("key, value")
      .in("key", ["stripe_enabled", "stripe_secret_key", "zelle_inbound_secret", "zelle_recipient"]),
  ]);
  const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));
  return {
    activeCount: active ?? 0,
    stripeEnabled: c.stripe_enabled === "true" && !!c.stripe_secret_key,
    zelleSecret: (c.zelle_inbound_secret as string) || "",
    zelleRecipient: (c.zelle_recipient as string) || "",
  };
}
