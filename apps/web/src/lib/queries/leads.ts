import { createServerSupabase } from "@/lib/supabase/server";

export async function getLeads(stage?: string) {
  const supabase = createServerSupabase();
  let query = supabase
    .from("leads")
    .select("*")
    .order("updated_at", { ascending: false });

  if (stage) query = query.eq("stage", stage);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getLead(id: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getLeadActivities(leadId: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
