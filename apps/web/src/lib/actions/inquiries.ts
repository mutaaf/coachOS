"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/types/database";

/** Move a website inquiry along: new → contacted → trial booked → registered, or lost. */
export async function updateInquiryStatus(id: string, status: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (!INQUIRY_STATUSES.includes(status as InquiryStatus)) return { error: "That isn't a status an inquiry can have." };
  const { data, error } = await createAdminSupabase()
    .from("inquiries")
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That inquiry is gone — refresh the page." };
  revalidatePath("/marketing");
  return { success: true as const };
}
