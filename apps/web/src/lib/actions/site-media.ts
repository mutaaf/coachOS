"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentUser, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { processPhoto } from "@/lib/site-media-images";
import {
  MAX_UPLOAD_BYTES,
  publishProblems,
  SITE_MEDIA_BUCKET,
  SLOTS,
  UPLOAD_TYPES,
  validSlot,
  type Rendition,
} from "@/lib/site-media";

/**
 * The website's photo library (contract v1.2).
 *
 * Uploading is two steps so a 15 MB phone photo never passes through a
 * serverless function's 4.5 MB request limit: startPhotoUpload checks the
 * caller and the file and hands back a one-time signed upload address for a
 * private-looking path; the browser sends the file straight to storage; then
 * finishPhotoUpload reads it back, makes it safe and small (lib/site-media-
 * images.ts) and records it. Nothing else can write to the bucket.
 *
 * Every change is live on the website within a minute: the site reads
 * public.site_media at runtime.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath("/website");
  revalidatePath("/programs/new");
}

type Answers = { contains_identifiable_minors?: boolean; photo_release_confirmed?: boolean };

/** Step 1: may this file be uploaded? Returns where to send it. Pass `replaceId` to replace a photo's file. */
export async function startPhotoUpload(file: { name: string; type: string; size: number }, replaceId?: string | null) {
  const user = await currentUser();
  if (!user) return NOT_SIGNED_IN;
  const ext = UPLOAD_TYPES[file?.type];
  if (!ext) return { error: `“${file?.name ?? "That file"}” isn't a photo we can use — choose a JPG, PNG, WebP, AVIF or GIF.` };
  if (!(file.size > 0)) return { error: `“${file.name}” is empty.` };
  if (file.size > MAX_UPLOAD_BYTES) return { error: `“${file.name}” is over 15 MB. Choose a smaller copy.` };

  const db = createAdminSupabase();
  let id = replaceId ?? null;
  if (id) {
    if (!UUID.test(id)) return { error: "That photo isn't in the library." };
    const { data } = await db.from("site_media").select("id").eq("id", id).maybeSingle();
    if (!data) return { error: "That photo isn't in the library any more." };
  } else {
    const { data, error } = await db
      .from("site_media")
      .insert({ original_filename: String(file.name).slice(0, 200), uploaded_by: user.id, mime_type: file.type })
      .select("id")
      .single();
    if (error) return { error: error.message };
    id = data.id as string;
  }

  const path = `incoming/${id}/${randomUUID()}.${ext}`;
  const { data: signed, error } = await db.storage.from(SITE_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !signed) return { error: error?.message ?? "Couldn't get the upload ready. Try again." };
  return { success: true as const, id, path, token: signed.token };
}

/** Step 2: the file is in storage — clean it, make its sizes, and record it. */
export async function finishPhotoUpload(id: string, path: string, answers?: Answers) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  if (!UUID.test(String(id)) || typeof path !== "string" || !path.startsWith(`incoming/${id}/`) || path.includes("..")) {
    return { error: "That upload doesn't belong to this photo." };
  }
  const db = createAdminSupabase();
  const bucket = db.storage.from(SITE_MEDIA_BUCKET);
  const { data: row } = await db.from("site_media").select("id, file_paths, published").eq("id", id).maybeSingle();
  if (!row) return { error: "That photo isn't in the library any more." };

  const { data: blob, error: readError } = await bucket.download(path);
  if (readError || !blob) return { error: "The upload didn't arrive. Try again." };
  const ext = path.split(".").pop() ?? "";
  const type = Object.entries(UPLOAD_TYPES).find(([, e]) => e === ext)?.[0] ?? blob.type;

  let processed;
  try {
    processed = await processPhoto(Buffer.from(await blob.arrayBuffer()), type);
  } catch (e) {
    await bucket.remove([path]);
    console.error("photo processing failed:", e);
    return { error: "That file couldn't be read as a photo. Try exporting it again as a JPG." };
  }

  // A fresh folder per version, so browsers and the CDN never show the old one.
  const folder = `${id}/${randomUUID().slice(0, 8)}`;
  const files: string[] = [];
  const put = async (name: string, data: Buffer, contentType: string) => {
    const p = `${folder}/${name}`;
    const { error } = await bucket.upload(p, data, { contentType, upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    files.push(p);
    return bucket.getPublicUrl(p).data.publicUrl;
  };
  let url: string;
  const srcset: Rendition[] = [];
  try {
    url = await put(`original.${processed.original.ext}`, processed.original.data, processed.original.contentType);
    for (const r of processed.renditions) srcset.push({ w: r.w, url: await put(`w${r.w}.webp`, r.data, "image/webp") });
  } catch (e) {
    if (files.length) await bucket.remove(files);
    return { error: `The photo wasn't saved: ${(e as Error).message}` };
  }

  const update: Record<string, unknown> = {
    status: "ready",
    original_path: files[0],
    file_paths: files,
    url,
    srcset,
    width: processed.width,
    height: processed.height,
    bytes: processed.original.data.length,
    mime_type: processed.original.contentType,
  };
  if (answers) {
    update.contains_identifiable_minors = !!answers.contains_identifiable_minors;
    update.photo_release_confirmed = !!answers.contains_identifiable_minors && !!answers.photo_release_confirmed;
  }
  let { error } = await db.from("site_media").update(update).eq("id", id);
  let unpublished = false;
  if (error && /site_media_publishable/.test(error.message)) {
    // The new answers don't allow it to stay up: keep the new file, take it down.
    ({ error } = await db.from("site_media").update({ ...update, published: false }).eq("id", id));
    unpublished = true;
  }
  if (error) {
    await bucket.remove(files);
    return { error: error.message };
  }
  await bucket.remove([path, ...((row.file_paths as string[]) ?? [])]);
  refresh();
  return { success: true as const, id, resized: processed.resized, unpublished };
}

export interface PhotoFields {
  alt?: string;
  caption?: string | null;
  focal_x?: number;
  focal_y?: number;
  contains_identifiable_minors?: boolean;
  photo_release_confirmed?: boolean;
  published?: boolean;
  notes?: string | null;
}

/** Save a photo's words, focal point, child-safety answers and whether it's on the site. */
export async function updatePhoto(id: string, fields: PhotoFields) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  if (!UUID.test(String(id)) || !fields || typeof fields !== "object") return { error: "That photo isn't in the library." };
  const db = createAdminSupabase();
  const { data: current } = await db
    .from("site_media")
    .select("status, url, alt, contains_identifiable_minors, photo_release_confirmed, published")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "That photo isn't in the library any more." };

  const row: Record<string, unknown> = {};
  if (fields.alt !== undefined) row.alt = String(fields.alt).trim().slice(0, 300);
  if (fields.caption !== undefined) row.caption = fields.caption ? String(fields.caption).trim().slice(0, 300) || null : null;
  if (fields.notes !== undefined) row.notes = fields.notes ? String(fields.notes).trim() || null : null;
  for (const k of ["focal_x", "focal_y"] as const) {
    if (fields[k] === undefined) continue;
    const v = Number(fields[k]);
    if (!(v >= 0 && v <= 1)) return { error: "Tap on the photo to set its focus point." };
    row[k] = Math.round(v * 1000) / 1000;
  }
  if (fields.contains_identifiable_minors !== undefined) row.contains_identifiable_minors = !!fields.contains_identifiable_minors;
  if (fields.photo_release_confirmed !== undefined) row.photo_release_confirmed = !!fields.photo_release_confirmed;
  // A release only means something for a photo with children in it.
  if ((row.contains_identifiable_minors ?? current.contains_identifiable_minors) === false) row.photo_release_confirmed = false;
  if (fields.published !== undefined) row.published = !!fields.published;

  const next = { ...current, ...row } as typeof current;
  if (next.published) {
    const wrong = publishProblems(next);
    if (wrong.length) return { error: wrong[0] };
  }
  const { error } = await db.from("site_media").update(row).eq("id", id);
  if (error) return { error: /site_media_publishable/.test(error.message) ? "It can't go on the website yet — check its description and the photo release." : error.message };
  refresh();
  return { success: true as const };
}

export async function setPhotoPublished(id: string, published: boolean) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  return updatePhoto(id, { published: !!published });
}

/** Delete a photo: its files, and every place it was shown. */
export async function deletePhoto(id: string) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  if (!UUID.test(String(id))) return { error: "That photo isn't in the library." };
  const db = createAdminSupabase();
  const { data: row } = await db.from("site_media").select("file_paths").eq("id", id).maybeSingle();
  if (!row) return { success: true as const };
  const { error } = await db.from("site_media").delete().eq("id", id);
  if (error) return { error: error.message };
  const bucket = db.storage.from(SITE_MEDIA_BUCKET);
  const paths = (row.file_paths as string[]) ?? [];
  // Uploads that were started and never finished, too.
  const { data: stray } = await bucket.list(`incoming/${id}`);
  await bucket.remove([...paths, ...(stray ?? []).map((f) => `incoming/${id}/${f.name}`)]);
  refresh();
  return { success: true as const };
}

/**
 * Show a photo in a place on the site. The slideshow (`hero`) takes several,
 * in order; every other place shows one, so this photo replaces whatever was
 * there.
 */
export async function placePhoto(mediaId: string, slot: string, offeringId?: string | null) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  const s = String(slot ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!UUID.test(String(mediaId)) || !validSlot(s)) return { error: "Pick where the photo should go." };
  const offering = s === "offering" ? String(offeringId ?? "") : null;
  if (s === "offering" && !UUID.test(offering!)) return { error: "Pick which program card." };
  const db = createAdminSupabase();

  const ordered = SLOTS.find((x) => x.slot === s)?.ordered ?? false;
  let sort = 0;
  if (ordered) {
    const { data: last } = await db.from("site_media_placements").select("sort_order").eq("slot", s).order("sort_order", { ascending: false }).limit(1);
    sort = ((last?.[0]?.sort_order as number | undefined) ?? -1) + 1;
  } else {
    let q = db.from("site_media_placements").delete().eq("slot", s).neq("media_id", mediaId);
    q = offering ? q.eq("offering_id", offering) : q.is("offering_id", null);
    const { error } = await q;
    if (error) return { error: error.message };
  }
  const { error } = await db
    .from("site_media_placements")
    .upsert({ media_id: mediaId, slot: s, offering_id: offering, sort_order: sort }, { onConflict: "media_id,slot,offering_id", ignoreDuplicates: true });
  if (error) {
    if (/foreign key/i.test(error.message)) return { error: "That photo or program is no longer there." };
    return { error: error.message };
  }
  refresh();
  return { success: true as const };
}

export async function removePlacement(placementId: string) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  if (!UUID.test(String(placementId))) return { error: "That isn't on the site." };
  const { error } = await createAdminSupabase().from("site_media_placements").delete().eq("id", placementId);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

/** Put a slot's photos in this order (the slideshow). */
export async function reorderSlot(slot: string, placementIds: string[]) {
  if (!(await currentUser())) return NOT_SIGNED_IN;
  if (!validSlot(String(slot)) || !Array.isArray(placementIds) || !placementIds.every((p) => UUID.test(String(p)))) {
    return { error: "Couldn't change the order." };
  }
  const db = createAdminSupabase();
  const results = await Promise.all(
    placementIds.map((id, i) => db.from("site_media_placements").update({ sort_order: i }).eq("id", id).eq("slot", slot))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  refresh();
  return { success: true as const };
}
