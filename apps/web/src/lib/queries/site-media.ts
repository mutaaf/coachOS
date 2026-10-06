import { createAdminPublicSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { thumbUrl, type Rendition } from "@/lib/site-media";

export interface Photo {
  id: string;
  status: "uploading" | "ready";
  url: string;
  thumb: string;
  srcset: Rendition[];
  width: number | null;
  height: number | null;
  bytes: number | null;
  original_filename: string | null;
  alt: string;
  caption: string | null;
  focal_x: number;
  focal_y: number;
  contains_identifiable_minors: boolean;
  photo_release_confirmed: boolean;
  published: boolean;
  created_at: string;
}

export interface Placement {
  id: string;
  media_id: string;
  slot: string;
  offering_id: string | null;
  sort_order: number;
}

/** A session that's on (or could be on) the website, and the picture its card shows now. */
export interface OfferingCard {
  id: string;
  title: string;
  school: string;
  sport: string | null;
  onSite: boolean;
  /** What the site shows now (site_offerings.image_url), if anything. */
  imageUrl: string | null;
}

export async function getPhotoLibrary() {
  const ops = createAdminSupabase();
  const site = createAdminPublicSupabase();
  const [photos, placements, sessions, offerings, sports] = await Promise.all([
    ops
      .from("site_media")
      .select("id, status, url, srcset, width, height, bytes, original_filename, alt, caption, focal_x, focal_y, contains_identifiable_minors, photo_release_confirmed, published, created_at")
      .order("created_at", { ascending: false }),
    ops.from("site_media_placements").select("id, media_id, slot, offering_id, sort_order").order("sort_order"),
    ops
      .from("programs")
      .select("id, name, status, schools(name), program_catalog(sport)")
      .in("status", ["active", "upcoming"])
      .order("name"),
    site.from("site_offerings").select("offering_id, title, image_url"),
    ops.from("program_catalog").select("sport").eq("status", "active"),
  ]);
  const shown = new Map(((offerings.data ?? []) as any[]).map((o) => [o.offering_id as string, o]));
  return {
    photos: ((photos.data ?? []) as any[]).map(
      (m): Photo => ({
        ...m,
        srcset: (m.srcset ?? []) as Rendition[],
        thumb: m.url ? thumbUrl(m) : "",
        focal_x: Number(m.focal_x),
        focal_y: Number(m.focal_y),
      })
    ),
    placements: (placements.data ?? []) as Placement[],
    offerings: ((sessions.data ?? []) as any[]).map(
      (p): OfferingCard => ({
        id: p.id,
        title: shown.get(p.id)?.title ?? p.name,
        school: p.schools?.name ?? "",
        sport: p.program_catalog?.sport ?? null,
        onSite: shown.has(p.id),
        imageUrl: shown.get(p.id)?.image_url ?? null,
      })
    ),
    sports: [...new Set(((sports.data ?? []) as { sport: string }[]).map((s) => s.sport.trim().toLowerCase()).filter(Boolean))].sort(),
  };
}
