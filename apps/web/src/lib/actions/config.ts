"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { NOT_SIGNED_IN, signedIn } from "@/lib/auth-guard";

/**
 * Settings hold the Stripe keys, the Zelle details parents send money to, and
 * the key that lets a script report payments. Only someone signed in changes
 * them — an action is callable by anyone holding its id, from any page.
 */
export async function updateConfig(key: string, value: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("config")
    .update({ value })
    .eq("key", key);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateMultipleConfigs(updates: { key: string; value: string }[]) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();
  for (const { key, value } of updates) {
    const { error } = await supabase
      .from("config")
      .update({ value: value.trim() })
      .eq("key", key);
    if (error) return { error: error.message };
  }
  // Settings feed every page (the tour, payment pages, emails); refresh them all.
  revalidatePath("/", "layout");
  return { success: true };
}
