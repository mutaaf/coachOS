"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { WHATSAPP_GROUP } from "@/lib/whatsapp";
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

/**
 * The monthly fee, read strictly. It used to be `parseFloat(...) || 120`, so a
 * scholarship program entered as $0 — or a fee left blank — was billed $120.
 * 0 is a real answer: the program is free and is never invoiced.
 */
function readMonthlyFee(formData: FormData): { fee: number } | { error: string } {
  const raw = String(formData.get("monthly_fee") ?? "").trim().replace(/^\$/, "");
  const fee = Number(raw);
  if (raw === "" || !Number.isFinite(fee) || fee < 0) {
    return { error: "What does this session cost per month? Enter 0 if it's free." };
  }
  return { fee: Math.round(fee * 100) / 100 };
}

/** An end date before the start date leaves the program no months to bill. */
function datesInOrder(startDate: string | null, endDate: string | null) {
  return !startDate || !endDate || endDate >= startDate;
}

const DATES_OUT_OF_ORDER = "The end date is before the start date.";

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
    whatsappGroupUrl: ((formData.get("whatsapp_group_url") as string) || "").trim() || null,
  };
}

/** A season's name, kept in programs.season for what still reads the text. */
async function seasonName(supabase: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { data } = await supabase.from("seasons").select("name").eq("id", seasonId).maybeSingle();
  return (data?.name as string) ?? null;
}

export async function createProgram(formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const catalogId = ((formData.get("catalog_id") as string) || "").trim() || null;
  const seasonId = ((formData.get("season_id") as string) || "").trim() || null;
  const season = seasonId ? await seasonName(supabase, seasonId) : (formData.get("season") as string | null);
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const fee = readMonthlyFee(formData);
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;
  const registration = readRegistrationFields(formData);
  if (registration.whatsappGroupUrl && !WHATSAPP_GROUP.test(registration.whatsappGroupUrl)) {
    return { error: "That isn't a WhatsApp group invite link. In the group, tap its name → Invite via link → Copy link. It starts with https://chat.whatsapp.com/" };
  }

  if (!schoolId || !name) {
    return { error: "School and name are required." };
  }
  if ("error" in fee) return { error: fee.error };
  if (!datesInOrder(startDate || null, endDate || null)) return { error: DATES_OUT_OF_ORDER };
  const monthlyFee = fee.fee;

  const { data: created, error } = await supabase
    .from("programs")
    .insert({
      school_id: schoolId,
      name,
      season: season || null,
      catalog_id: catalogId,
      season_id: seasonId,
      start_date: startDate || null,
      end_date: endDate || null,
      monthly_fee: monthlyFee,
      status: status || "upcoming",
      notes: notes || null,
      capacity: registration.capacity,
      registration_open: registration.registrationOpen,
      location: registration.location,
      public_description: registration.publicDescription,
      whatsapp_group_url: registration.whatsappGroupUrl,
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
  await requireSignedIn();
  const supabase = createAdminSupabase();

  const schoolId = formData.get("school_id") as string;
  const name = formData.get("name") as string;
  const catalogId = ((formData.get("catalog_id") as string) || "").trim() || null;
  const seasonId = ((formData.get("season_id") as string) || "").trim() || null;
  const season = seasonId ? await seasonName(supabase, seasonId) : (formData.get("season") as string | null);
  const startDate = formData.get("start_date") as string | null;
  const endDate = formData.get("end_date") as string | null;
  const fee = readMonthlyFee(formData);
  const status = formData.get("status") as string;
  const notes = formData.get("notes") as string | null;
  const registration = readRegistrationFields(formData);
  if (registration.whatsappGroupUrl && !WHATSAPP_GROUP.test(registration.whatsappGroupUrl)) {
    return { error: "That isn't a WhatsApp group invite link. In the group, tap its name → Invite via link → Copy link. It starts with https://chat.whatsapp.com/" };
  }

  if (!schoolId || !name) {
    return { error: "School and name are required." };
  }
  if ("error" in fee) return { error: fee.error };
  if (!datesInOrder(startDate || null, endDate || null)) return { error: DATES_OUT_OF_ORDER };
  const monthlyFee = fee.fee;

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
      catalog_id: catalogId,
      season_id: seasonId,
      start_date: startDate || null,
      end_date: endDate || null,
      monthly_fee: monthlyFee,
      status: status || "upcoming",
      notes: notes || null,
      capacity: registration.capacity,
      registration_open: registration.registrationOpen,
      location: registration.location,
      public_description: registration.publicDescription,
      whatsapp_group_url: registration.whatsappGroupUrl,
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
  if (!(await signedIn())) return NOT_SIGNED_IN;
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
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  // Fetch source program
  const { data: source, error: fetchError } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .single();

  if (fetchError || !source) {
    return { error: "The session to copy wasn't found." };
  }

  // Insert copy with target school and upcoming status
  const { data: newProgram, error: insertError } = await supabase
    .from("programs")
    .insert({
      school_id: targetSchoolId,
      name: source.name,
      season: source.season,
      catalog_id: source.catalog_id ?? null,
      season_id: source.season_id ?? null,
      start_date: source.start_date,
      end_date: source.end_date,
      monthly_fee: source.monthly_fee,
      status: "upcoming",
      notes: source.notes,
    })
    .select("id")
    .single();

  if (insertError || !newProgram) {
    return { error: insertError?.message || "Failed to duplicate session." };
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
