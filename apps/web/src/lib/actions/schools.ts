"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createSchool(formData: FormData) {
  const supabase = createServerSupabase();

  const name = formData.get("name") as string;
  const address = formData.get("address") as string | null;
  const contact_name = formData.get("contact_name") as string | null;
  const contact_email = formData.get("contact_email") as string | null;
  const contact_phone = formData.get("contact_phone") as string | null;
  const notes = formData.get("notes") as string | null;

  if (!name || name.trim().length === 0) {
    return { error: "School name is required." };
  }

  const { data, error } = await supabase
    .from("schools")
    .insert({
      name: name.trim(),
      address: address?.trim() || null,
      contact_name: contact_name?.trim() || null,
      contact_email: contact_email?.trim() || null,
      contact_phone: contact_phone?.trim() || null,
      notes: notes?.trim() || null,
      status: "active",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating school:", error);
    return { error: "Failed to create school. Please try again." };
  }

  revalidatePath("/schools");
  return { data };
}

export async function updateSchool(id: string, formData: FormData) {
  const supabase = createServerSupabase();

  const name = formData.get("name") as string;
  const address = formData.get("address") as string | null;
  const contact_name = formData.get("contact_name") as string | null;
  const contact_email = formData.get("contact_email") as string | null;
  const contact_phone = formData.get("contact_phone") as string | null;
  const notes = formData.get("notes") as string | null;

  if (!name || name.trim().length === 0) {
    return { error: "School name is required." };
  }

  const { data, error } = await supabase
    .from("schools")
    .update({
      name: name.trim(),
      address: address?.trim() || null,
      contact_name: contact_name?.trim() || null,
      contact_email: contact_email?.trim() || null,
      contact_phone: contact_phone?.trim() || null,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating school:", error);
    return { error: "Failed to update school. Please try again." };
  }

  revalidatePath("/schools");
  revalidatePath(`/schools/${id}`);
  return { data };
}

export async function archiveSchool(id: string) {
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("schools")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Error archiving school:", error);
    return { error: "Failed to archive school. Please try again." };
  }

  revalidatePath("/schools");
  revalidatePath(`/schools/${id}`);
  return { success: true };
}
