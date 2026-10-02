"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { assignPayment, type AssignInput } from "@/lib/payment-assign";

/** "Who paid this?" — see lib/payment-assign.ts. */
export async function assignUnrecognisedPayment(input: AssignInput) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const result = await assignPayment(createAdminSupabase(), input);
  if (!("error" in result)) {
    for (const path of ["/payments", "/dashboard", "/students", "/schools"]) revalidatePath(path);
  }
  return result;
}
