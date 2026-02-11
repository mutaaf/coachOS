"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateConfig(key: string, value: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("config")
    .update({ value })
    .eq("key", key);
  if (error) throw error;
  revalidatePath("/settings");
}

export async function updateMultipleConfigs(updates: { key: string; value: string }[]) {
  const supabase = createServerSupabase();
  for (const { key, value } of updates) {
    const { error } = await supabase
      .from("config")
      .update({ value })
      .eq("key", key);
    if (error) throw error;
  }
  revalidatePath("/settings");
}
