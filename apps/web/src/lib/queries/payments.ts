import { createServerSupabase } from "@/lib/supabase/server";

export async function getInvoices(filters?: {
  status?: string;
  month?: string;
  parentId?: string;
}) {
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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
    .filter((i) => i.status === "pending")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueAmount = (overdueRes.data || []).reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueCount = overdueRes.data?.length || 0;
  const paidThisMonth = (monthPayRes.data || []).reduce((sum, p) => sum + Number(p.amount), 0);

  return { totalRevenue, pendingAmount, overdueAmount, overdueCount, paidThisMonth };
}

export async function getOverdueInvoices() {
  const supabase = createServerSupabase();
  const today = new Date().toISOString().split("T")[0];

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
