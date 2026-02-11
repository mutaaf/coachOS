import { createServerSupabase } from "@/lib/supabase/server";
import type { Config, WhatsAppState } from "@/types/database";

export async function getConfig(): Promise<Config[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function getConfigByCategory(category: string): Promise<Config[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .eq("category", category)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function getConfigValue(key: string): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", key)
    .single();
  if (error) return null;
  return data?.value || null;
}

export async function getWhatsAppState(): Promise<WhatsAppState | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("whatsapp_state")
    .select("*")
    .limit(1)
    .single();
  if (error) return null;
  return data;
}
