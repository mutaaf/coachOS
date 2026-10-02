"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { signedIn } from "@/lib/auth-guard";

export interface TourContext {
  businessName: string;
  zelleInbox: string;
  zelleForwardFrom: string;
}

/**
 * The addresses the tour talks about, read from Settings so that changing them
 * there changes what the tour says — no deploy.
 */
export async function getTourContext(): Promise<TourContext | null> {
  if (!(await signedIn())) return null;
  const { data } = await createAdminSupabase()
    .from("config")
    .select("key, value")
    .in("key", ["business_name", "zelle_alerts_inbox", "zelle_alerts_forward_from"]);
  const c = Object.fromEntries((data || []).map((r) => [r.key, (r.value as string)?.trim() ?? ""]));
  return {
    businessName: c.business_name || "your business",
    zelleInbox: c.zelle_alerts_inbox || "",
    zelleForwardFrom: c.zelle_alerts_forward_from || "",
  };
}
