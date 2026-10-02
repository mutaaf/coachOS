import { createAdminSupabase } from "@/lib/supabase/server";

export async function getMessageTemplates(category?: string) {
  const supabase = createAdminSupabase();
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
  const supabase = createAdminSupabase();
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
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("message_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getMessageStats() {
  const supabase = createAdminSupabase();
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

/**
 * Messages waiting for the owner to send from her phone, oldest first so the
 * list reads in the order things happened, plus the last day's sent and
 * skipped ones so a mis-tap can be undone.
 */
export async function getOutbox() {
  const supabase = createAdminSupabase();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [waiting, done] = await Promise.all([
    supabase
      .from("message_queue")
      .select("id, recipient_name, recipient_phone, message, created_at")
      .in("status", ["pending", "sending"])
      .order("created_at")
      .limit(200),
    supabase
      .from("message_queue")
      .select("id, recipient_name, recipient_phone, message, status, sent_via, updated_at")
      .in("status", ["sent", "skipped"])
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  return { waiting: waiting.data || [], done: done.data || [] };
}
