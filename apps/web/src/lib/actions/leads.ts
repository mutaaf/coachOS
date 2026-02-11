"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createLead(formData: FormData) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("leads").insert({
    school_name: formData.get("school_name") as string,
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
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
  const { error } = await supabase.from("lead_activities").insert({
    lead_id: leadId,
    type: formData.get("type") as string,
    description: formData.get("description") as string,
  });
  if (error) throw error;
  revalidatePath("/marketing");
}

export async function convertLeadToSchool(leadId: string) {
  const supabase = createServerSupabase();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) throw leadError || new Error("Lead not found");

  const { error: schoolError } = await supabase.from("schools").insert({
    name: lead.school_name,
    address: lead.address,
    contact_name: lead.contact_name,
    contact_email: lead.contact_email,
    contact_phone: lead.contact_phone,
    status: "active",
  });
  if (schoolError) throw schoolError;

  await supabase.from("leads").update({ stage: "signed" }).eq("id", leadId);
  await supabase.from("lead_activities").insert({
    lead_id: leadId,
    type: "stage_change",
    description: "Converted to school",
  });

  revalidatePath("/marketing");
  revalidatePath("/schools");
}
