"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminPublicSupabase } from "@/lib/supabase/server";
import { IMAGE_BUCKET } from "@/lib/website";

/**
 * Editing risingstars.training from CoachOS. Each writes the site's own tables
 * (public schema), so it's live on the site as soon as it saves.
 */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function refresh() {
  revalidatePath("/website");
}

/** Create (no id) or update a program listing. */
export async function saveListing(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = s(form, "id");
  const type = s(form, "type");
  const row = {
    title: s(form, "title"),
    description: s(form, "description"),
    type: type === "upcoming" ? "upcoming" : "current",
    start_date: date(s(form, "start_date")),
    end_date: date(s(form, "end_date")),
    date_range: s(form, "date_range"),
    location: s(form, "location"),
    price: s(form, "price"),
    slots: s(form, "slots"),
    image: s(form, "image"),
    age_groups: form.getAll("age_groups").map(String).filter(Boolean),
    registration_date: s(form, "registration_date") || null,
    ops_program_id: s(form, "ops_program_id") || null,
  };
  if (!row.title) return { error: "Give the listing a title." };
  if (!row.description) return { error: "Add a short description — it's what parents read first." };
  if (row.start_date && row.end_date && row.end_date < row.start_date) {
    return { error: "The end date is before the start date." };
  }
  const site = createAdminPublicSupabase();
  // One listing per CoachOS program: linking this one unlinks any other.
  if (row.ops_program_id) {
    let q = site.from("programs").update({ ops_program_id: null }).eq("ops_program_id", row.ops_program_id);
    if (id) q = q.neq("id", id);
    await q;
  }
  const { data, error } = id
    ? await site.from("programs").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select("id").single()
    : await site.from("programs").insert(row).select("id").single();
  if (error) return { error: error.message };
  refresh();
  return { success: true as const, id: data.id as string };
}

export async function deleteListing(id: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { error } = await createAdminPublicSupabase().from("programs").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Upload a picture for a listing; returns its public address. */
export async function uploadWebsiteImage(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a picture." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "That isn't a picture we can use — choose a JPG, PNG, WebP or GIF." };
  if (file.size > 5 * 1024 * 1024) return { error: "That picture is over 5 MB. A smaller one loads faster for parents." };
  const site = createAdminPublicSupabase();
  // The bucket exists in production; a fresh database (tests) makes it.
  const { data: bucket } = await site.storage.getBucket(IMAGE_BUCKET);
  if (!bucket) await site.storage.createBucket(IMAGE_BUCKET, { public: true });
  const path = `program/program_${Date.now()}.${ext}`;
  const { error } = await site.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: error.message };
  return { success: true as const, url: site.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl };
}

export async function saveTestimonial(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = s(form, "id");
  const stars = Math.round(Number(s(form, "stars")));
  const row = {
    name: s(form, "name"),
    relationship: s(form, "relationship"),
    quote: s(form, "quote"),
    stars: stars >= 1 && stars <= 5 ? stars : 5,
    avatar: s(form, "avatar") || null,
  };
  if (!row.name || !row.quote) return { error: "A testimonial needs a name and what they said." };
  const site = createAdminPublicSupabase();
  const { error } = id
    ? await site.from("testimonials").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id)
    : await site.from("testimonials").insert(row);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

export async function deleteTestimonial(id: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { error } = await createAdminPublicSupabase().from("testimonials").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

export async function savePartnership(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = s(form, "id");
  const row = {
    type: s(form, "type"),
    icon: s(form, "icon") || "🤝",
    description: s(form, "description"),
    benefits: s(form, "benefits")
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean),
  };
  if (!row.type || !row.description) return { error: "A partnership needs a name and a description." };
  const site = createAdminPublicSupabase();
  const { error } = id
    ? await site.from("partnerships").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id)
    : await site.from("partnerships").insert(row);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

export async function deletePartnership(id: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { error } = await createAdminPublicSupabase().from("partnerships").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}
