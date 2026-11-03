"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN, currentUser } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { familyHref } from "@/lib/family-link";

/**
 * Consent the Boss records by hand: a parent who texts STOP to her phone, says
 * "please don't post photos of him", signs a paper photo release, or asks to
 * come off the newsletter. Each goes through ops.record_consent, so the
 * column and the consent history move together, and a STOP clears anything
 * already waiting in the Outbox.
 */

type Kind = "sms" | "sms_promotional" | "marketing_email" | "photo";

async function record(kind: Kind, granted: boolean, ids: { parentId?: string; studentId?: string }) {
  const user = await currentUser();
  const { error } = await createAdminSupabase().rpc("record_consent", {
    p_kind: kind,
    p_granted: granted,
    p_source: "staff",
    p_parent_id: ids.parentId ?? null,
    p_student_id: ids.studentId ?? null,
    p_recorded_by: user?.id ?? null,
  });
  return error ? { error: error.message } : { success: true as const };
}

/**
 * The parent agreed to, or asked to stop, program texts (STOP, QUIT, CANCEL…
 * or in person). A STOP stops every text: the database withdraws promotional
 * consent with it (ops.record_consent).
 */
export async function recordSmsChoice(parentId: string, granted: boolean) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const result = await record("sms", granted, { parentId });
  revalidatePath(familyHref(parentId));
  revalidatePath("/messaging");
  return result;
}

/**
 * The parent agreed to, or withdrew from, promotional texts (offers, new
 * programs). Separate from program texts: Rising Stars isn't registered as a
 * Texas telephone solicitor, so a promotion goes only to a parent with this
 * consent on file. A STOP (recordSmsChoice false) withdraws it as well.
 */
export async function recordSmsPromotionalChoice(parentId: string, granted: boolean) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const result = await record("sms_promotional", granted, { parentId });
  revalidatePath(familyHref(parentId));
  revalidatePath("/messaging");
  return result;
}

/** The parent opted in to, or out of, newsletters and promotions. */
export async function recordMarketingEmailChoice(parentId: string, granted: boolean) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const result = await record("marketing_email", granted, { parentId });
  if (!granted && !("error" in result)) {
    const supabase = createAdminSupabase();
    const { data: parent } = await supabase.from("parents").select("email").eq("id", parentId).maybeSingle();
    if (parent?.email) {
      await supabase
        .from("email_suppressions")
        .upsert({ email: parent.email.trim().toLowerCase(), scope: "marketing", reason: "manual" }, { onConflict: "email", ignoreDuplicates: true });
    }
  }
  revalidatePath(familyHref(parentId));
  return result;
}

/** A photo release given or withdrawn for one child. */
export async function setPhotoRelease(studentId: string, granted: boolean, parentId?: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const result = await record("photo", granted, { studentId, parentId });
  if (parentId) revalidatePath(familyHref(parentId));
  revalidatePath("/students");
  return result;
}
