"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getLeadActivities } from "@/lib/queries/leads";
import { findSchoolNamed, sameName } from "@/lib/identity";

export async function fetchLeadActivities(leadId: string) {
  await requireSignedIn();
  return getLeadActivities(leadId);
}

export async function createLead(formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const schoolName = formData.get("school_name") as string;
  const { data: leads } = await supabase.from("leads").select("school_name");
  const same = (leads ?? []).find((l) => sameName(l.school_name, schoolName));
  if (same) return { error: `${same.school_name} is already in your pipeline.` };

  const { error } = await supabase.from("leads").insert({
    school_name: schoolName,
    contact_name: formData.get("contact_name") as string || null,
    contact_email: formData.get("contact_email") as string || null,
    contact_phone: formData.get("contact_phone") as string || null,
    address: formData.get("address") as string || null,
    estimated_students: formData.get("estimated_students") ? Number(formData.get("estimated_students")) : null,
    notes: formData.get("notes") as string || null,
    next_follow_up: formData.get("next_follow_up") as string || null,
  });
  if (error) throw error;
  revalidatePath("/marketing");
}

export async function updateLead(id: string, formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("leads")
    .update({
      school_name: formData.get("school_name") as string,
      contact_name: formData.get("contact_name") as string || null,
      contact_email: formData.get("contact_email") as string || null,
      contact_phone: formData.get("contact_phone") as string || null,
      address: formData.get("address") as string || null,
      estimated_students: formData.get("estimated_students") ? Number(formData.get("estimated_students")) : null,
      notes: formData.get("notes") as string || null,
      next_follow_up: formData.get("next_follow_up") as string || null,
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/marketing");
}

export async function updateLeadStage(id: string, stage: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("leads")
    .update({ stage })
    .eq("id", id);
  if (error) throw error;

  // Log stage change
  await supabase.from("lead_activities").insert({
    lead_id: id,
    type: "stage_change",
    description: `Stage changed to ${stage}`,
  });

  revalidatePath("/marketing");
}

export async function addLeadActivity(leadId: string, formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("lead_activities").insert({
    lead_id: leadId,
    type: formData.get("type") as string,
    description: formData.get("description") as string,
  });
  if (error) throw error;
  revalidatePath("/marketing");
}

export async function deleteLead(leadId: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();

  // Delete lead activities first
  await supabase.from("lead_activities").delete().eq("lead_id", leadId);

  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) throw error;
  revalidatePath("/marketing");
}

export async function convertLeadToSchool(leadId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) throw leadError || new Error("Lead not found");

  // Claim the lead before making anything: of two taps on Convert, only the
  // one that moves it to "signed" goes on to add the school.
  const { data: claimed } = await supabase
    .from("leads")
    .update({ stage: "signed" })
    .eq("id", leadId)
    .neq("stage", "signed")
    .select("id");
  if (!claimed?.length) return { error: `${lead.school_name} has already been converted.` };

  // A school already on the list is that school, not a second one.
  if (!(await findSchoolNamed(supabase, lead.school_name))) {
    const { error: schoolError } = await supabase.from("schools").insert({
      name: lead.school_name,
      address: lead.address,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone,
      status: "active",
    });
    if (schoolError) {
      await supabase.from("leads").update({ stage: lead.stage }).eq("id", leadId);
      throw schoolError;
    }
  }

  await supabase.from("lead_activities").insert({
    lead_id: leadId,
    type: "stage_change",
    description: "Converted to school",
  });

  revalidatePath("/marketing");
  revalidatePath("/schools");
}
