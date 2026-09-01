"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { WhatsAppState } from "@/types/database";

export async function updateConfig(key: string, value: string) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("config")
    .update({ value })
    .eq("key", key);
  if (error) throw error;
  revalidatePath("/settings");
}

export async function fetchWhatsAppState(): Promise<WhatsAppState | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("whatsapp_state")
    .select("*")
    .limit(1)
    .maybeSingle();
  return data;
}

export async function updateMultipleConfigs(updates: { key: string; value: string }[]) {
  const supabase = createAdminSupabase();
  for (const { key, value } of updates) {
    const { error } = await supabase
      .from("config")
      .update({ value })
      .eq("key", key);
    if (error) throw error;
  }
  revalidatePath("/settings");
}
