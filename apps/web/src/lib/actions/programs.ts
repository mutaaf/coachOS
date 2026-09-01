"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase, createAdminPublicSupabase } from "@/lib/supabase/server";

/** URL-safe identifier for a program's public registration link. */
function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build a slug from the school and program name, adding a numeric suffix if
 * that link is already taken. Generated rather than typed: the link goes into
 * WhatsApp groups, and nobody should have to invent one.
 */
async function uniqueSlug(
  supabase: ReturnType<typeof createAdminSupabase>,
  schoolId: string,
  programName: string,
  currentProgramId?: string
) {
  const { data: school } = await supabase
    .from("schools")
    .select("name")
    .eq("id", schoolId)
    .maybeSingle();

  const base = slugify(`${school?.name ?? ""} ${programName}`) || "program";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    let query = supabase.from("programs").select("id").eq("public_slug", candidate);
    if (currentProgramId) query = query.neq("id", currentProgramId);
    const { data: taken } = await query.maybeSingle();
    if (!taken) return candidate;
  }

  return `${base}-${Date.now()}`;
}

/**
 * Point a website listing at this program, and clear any listing that used to
 * point here. Passing an empty listing id unlinks without touching anything else.
 */
async function linkWebsiteListing(programId: string, listingId: string | null) {
  const cms = createAdminPublicSupabase();

  await cms
    .from("programs")
    .update({ ops_program_id: null })
    .eq("ops_program_id", programId);

  if (listingId) {
    await cms.from("programs").update({ ops_program_id: programId }).eq("id", listingId);
  }
}

/** Fields shared by create and update, read off the form. */
function readRegistrationFields(formData: FormData) {
  const capacityRaw = parseInt(formData.get("capacity") as string, 10);
  return {
    capacity: Number.isFinite(capacityRaw) && capacityRaw > 0 ? capacityRaw : 12,
    registrationOpen: formData.get("registration_open") === "true",
    location: ((formData.get("location") as string) || "").trim() || null,
    publicDescription:
      ((formData.get("public_description") as string) || "").trim() || null,
    websiteListingId: ((formData.get("website_listing_id") as string) || "").trim() || null,
  };
}

export async function createProgram(formData: FormData) {
  const supabase = createAdminSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const season = formData.get("season") as string | null;
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const monthlyFee = parseFloat(formData.get("monthly_fee") as string) || 120;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;
  const registration = readRegistrationFields(formData);

  if (!schoolId || !name) {
    return { error: "School and program name are required." };
  }

  const { data: created, error } = await supabase
    .from("programs")
    .insert({
      school_id: schoolId,
      name,
      season: season || null,
      start_date: startDate || null,
      end_date: endDate || null,
      monthly_fee: monthlyFee,
      status: status || "upcoming",
      notes: notes || null,
      capacity: registration.capacity,
      registration_open: registration.registrationOpen,
      location: registration.location,
      public_description: registration.publicDescription,
      public_slug: await uniqueSlug(supabase, schoolId, name),
    })
    .select("id, public_slug")
    .single();

  if (error) {
    return { error: error.message };
  }

  await linkWebsiteListing(created.id, registration.websiteListingId);

  revalidatePath("/schools");
  revalidatePath(`/schools/${schoolId}`);
  revalidatePath("/registrations");

  return { success: true, slug: created.public_slug as string };
}

export async function updateProgram(id: string, formData: FormData) {
  const supabase = createAdminSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const season = formData.get("season") as string | null;
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const monthlyFee = parseFloat(formData.get("monthly_fee") as string) || 120;
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;
  const registration = readRegistrationFields(formData);

  if (!schoolId || !name) {
    return { error: "School and program name are required." };
  }

  // Keep an existing link stable — it may already be in WhatsApp groups.
  const { data: existing } = await supabase
    .from("programs")
    .select("public_slug")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("programs")
    .update({
      school_id: schoolId,
      name,
      season: season || null,
      start_date: startDate || null,
      end_date: endDate || null,
      monthly_fee: monthlyFee,
      status: status || "upcoming",
      notes: notes || null,
      capacity: registration.capacity,
      registration_open: registration.registrationOpen,
      location: registration.location,
      public_description: registration.publicDescription,
      public_slug:
        existing?.public_slug ?? (await uniqueSlug(supabase, schoolId, name, id)),
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  await linkWebsiteListing(id, registration.websiteListingId);

  revalidatePath("/schools");
  revalidatePath(`/schools/${schoolId}`);
  revalidatePath("/registrations");

  return { success: true };
}

export async function updateProgramStatus(
  id: string,
  status: "active" | "upcoming" | "completed" | "cancelled"
) {
  const supabase = createAdminSupabase();

  // Fetch the program first to get the school_id for revalidation
  const { data: program } = await supabase
    .from("programs")
    .select("school_id")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("programs")
    .update({ status })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/schools");
  if (program?.school_id) {
    revalidatePath(`/schools/${program.school_id}`);
  }

  return { success: true };
}

export async function duplicateProgram(
  programId: string,
  targetSchoolId: string
) {
  const supabase = createAdminSupabase();

  // Fetch source program
  const { data: source, error: fetchError } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .single();

  if (fetchError || !source) {
    return { error: "Source program not found." };
  }

  // Insert copy with target school and upcoming status
  const { data: newProgram, error: insertError } = await supabase
    .from("programs")
    .insert({
      school_id: targetSchoolId,
      name: source.name,
      season: source.season,
      start_date: source.start_date,
      end_date: source.end_date,
      monthly_fee: source.monthly_fee,
      status: "upcoming",
      notes: source.notes,
    })
    .select("id")
    .single();

  if (insertError || !newProgram) {
    return { error: insertError?.message || "Failed to duplicate program." };
  }

  // Copy schedule templates
  const { data: templates } = await supabase
    .from("schedule_templates")
    .select("day_of_week, start_time, end_time, location")
    .eq("program_id", programId);

  if (templates && templates.length > 0) {
    await supabase.from("schedule_templates").insert(
      templates.map((t) => ({
        program_id: newProgram.id,
        day_of_week: t.day_of_week,
        start_time: t.start_time,
        end_time: t.end_time,
        location: t.location,
      }))
    );
  }

  revalidatePath("/schools");
  revalidatePath(`/schools/${targetSchoolId}`);

  return { success: true };
}
