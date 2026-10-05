import { createAdminSupabase } from "@/lib/supabase/server";
import type { Inquiry } from "@/types/database";

export type InquiryWithOffering = Inquiry & {
  offering: { id: string; name: string; school: { name: string } | null } | null;
};

/** Families' questions from the website, newest first. */
export async function getInquiries() {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("inquiries")
    .select("*, offering:programs(id, name, school:schools(name))")
    // Privacy requests have their own queue, with a legal deadline (Compliance page).
    .neq("kind", "privacy_request")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as InquiryWithOffering[];
}
