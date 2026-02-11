import { createServerSupabase } from "@/lib/supabase/server";

export async function getMessageTemplates(category?: string) {
  const supabase = createServerSupabase();
  let query = supabase
    .from("message_templates")
    .select("*")
    .eq("is_active", true)
    .order("category")
    .order("name");

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getMessageQueue(status?: string) {
  const supabase = createServerSupabase();
  let query = supabase
    .from("message_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getMessageLog(limit: number = 50) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("message_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getMessageStats() {
  const supabase = createServerSupabase();
  const [sentRes, pendingRes, failedRes] = await Promise.all([
    supabase.from("message_log").select("id", { count: "exact" }).eq("status", "sent"),
    supabase.from("message_queue").select("id", { count: "exact" }).eq("status", "pending"),
    supabase.from("message_queue").select("id", { count: "exact" }).eq("status", "failed"),
  ]);

  return {
    totalSent: sentRes.count || 0,
    pendingCount: pendingRes.count || 0,
    failedCount: failedRes.count || 0,
  };
}
