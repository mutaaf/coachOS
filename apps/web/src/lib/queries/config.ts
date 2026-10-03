import { createAdminSupabase } from "@/lib/supabase/server";
import type { Config } from "@/types/database";

export async function getConfig(): Promise<Config[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function getConfigByCategory(category: string): Promise<Config[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .eq("category", category)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

/** Default Monthly Fee in Settings, filled in for a new program. Blank leaves the box empty. */
export async function getDefaultMonthlyFee(): Promise<string> {
  const value = (await getConfigValue("default_monthly_fee"))?.trim() ?? "";
  return value !== "" && Number(value) >= 0 ? value : "";
}

export async function getConfigValue(key: string): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", key)
    .single();
  if (error) return null;
  return data?.value || null;
}
