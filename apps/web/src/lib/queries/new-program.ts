import { createAdminSupabase } from "@/lib/supabase/server";
import { businessToday } from "@/lib/dates";
import { publishProblems, thumbUrl } from "@/lib/site-media";
import type { ExistingSession, FlowContext, Slot } from "@/lib/new-program";

const hhmm = (t: string) => t.slice(0, 5);

/** Everything the New program page needs to offer sensible defaults. */
export async function getNewProgramContext(): Promise<FlowContext> {
  const db = createAdminSupabase();
  const [catalog, schools, seasons, coaches, sessions, photos, cards] = await Promise.all([
    db.from("program_catalog").select("id, name, sport, description, age_groups, default_monthly_fee, default_capacity, status").order("name"),
    db.from("schools").select("id, name, address").neq("status", "archived").order("name"),
    db.from("seasons").select("id, name, start_date, end_date, status").order("start_date", { ascending: false, nullsFirst: false }),
    db.from("coaches").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    db
      .from("programs")
      .select("id, catalog_id, school_id, season_id, monthly_fee, capacity, location, registration_open, created_at, schedule_templates(day_of_week, start_time, end_time, coach_id)")
      .order("created_at", { ascending: false }),
    db
      .from("site_media")
      .select("id, url, srcset, alt, focal_x, focal_y, published, contains_identifiable_minors, photo_release_confirmed, status")
      .eq("status", "ready")
      .order("created_at", { ascending: false }),
    db.from("site_media_placements").select("media_id, offering_id").eq("slot", "offering"),
  ]);
  const cardPhoto = new Map(((cards.data ?? []) as { media_id: string; offering_id: string }[]).map((c) => [c.offering_id, c.media_id]));

  const existing: ExistingSession[] = ((sessions.data ?? []) as any[]).map((p) => {
    const templates = (p.schedule_templates ?? []) as { day_of_week: number; start_time: string; end_time: string; coach_id: string | null }[];
    return {
      id: p.id,
      catalog_id: p.catalog_id,
      school_id: p.school_id,
      season_id: p.season_id,
      monthly_fee: Number(p.monthly_fee),
      capacity: p.capacity,
      location: p.location,
      coach_id: templates.find((t) => t.coach_id)?.coach_id ?? null,
      slots: templates.map((t): Slot => ({ dow: t.day_of_week, start: hhmm(t.start_time), end: hhmm(t.end_time) })),
      registration_open: p.registration_open,
      media_id: cardPhoto.get(p.id) ?? null,
      created_at: p.created_at,
    };
  });

  // A school's usual weekly time: that of its most recent session that had one.
  const usual = new Map<string, Slot[]>();
  for (const s of existing) if (s.slots.length && !usual.has(s.school_id)) usual.set(s.school_id, s.slots);

  return {
    catalog: ((catalog.data ?? []) as any[]).map((c) => ({ ...c, default_monthly_fee: Number(c.default_monthly_fee) })),
    schools: ((schools.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name, address: s.address, usualSlots: usual.get(s.id) ?? [] })),
    seasons: (seasons.data ?? []) as FlowContext["seasons"],
    coaches: ((coaches.data ?? []) as any[]).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() })),
    photos: ((photos.data ?? []) as any[]).map((m) => ({
      id: m.id,
      url: m.url,
      thumb: thumbUrl(m),
      alt: m.alt,
      focal_x: Number(m.focal_x),
      focal_y: Number(m.focal_y),
      live: m.published && publishProblems(m).length === 0,
    })),
    sessions: existing,
    today: businessToday(),
  };
}
