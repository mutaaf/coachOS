import { createAdminSupabase } from "@/lib/supabase/server";

export interface Season {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: "upcoming" | "active" | "closed";
  no_class_dates: string[];
  sessionCount: number;
}

export interface SessionRow {
  id: string;
  school_id: string;
  school_name: string;
  season_id: string | null;
  season_name: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  capacity: number;
  enrolled: number;
  monthly_fee: number;
  /** "Tue 3:30–4:30 PM" for each weekly time. */
  times: string[];
  registration_open: boolean;
  public_slug: string | null;
}

export interface CatalogProgram {
  id: string;
  name: string;
  sport: string;
  description: string;
  age_groups: string[];
  default_monthly_fee: number;
  default_capacity: number;
  image: string | null;
  status: "active" | "archived";
  sessions: SessionRow[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
const half = (t: string) => (Number(t.split(":")[0]) >= 12 ? "PM" : "AM");
export function weeklyTime(t: { day_of_week: number; start_time: string; end_time: string }) {
  const start = half(t.start_time) === half(t.end_time) ? clock(t.start_time) : `${clock(t.start_time)} ${half(t.start_time)}`;
  return `${DAYS[t.day_of_week]} ${start}–${clock(t.end_time)} ${half(t.end_time)}`;
}

/** Everything the Programs page shows. */
export async function getProgramsPage() {
  const db = createAdminSupabase();
  const [catalog, sessions, seasons, schools, enrolled] = await Promise.all([
    db.from("program_catalog").select("*").order("status").order("name"),
    db
      .from("programs")
      .select("id, catalog_id, school_id, season_id, status, start_date, end_date, capacity, monthly_fee, registration_open, public_slug, schools(name), seasons(name), schedule_templates(day_of_week, start_time, end_time)")
      .order("start_date", { ascending: false, nullsFirst: false }),
    db.from("seasons").select("*").order("start_date", { ascending: false, nullsFirst: false }),
    db.from("schools").select("id, name").neq("status", "archived").order("name"),
    db.from("enrollments").select("program_id").eq("status", "active"),
  ]);
  const count = new Map<string, number>();
  for (const e of enrolled.data || []) count.set(e.program_id, (count.get(e.program_id) ?? 0) + 1);

  const rows = ((sessions.data || []) as any[]).map((p): SessionRow & { catalog_id: string | null } => ({
    id: p.id,
    catalog_id: p.catalog_id,
    school_id: p.school_id,
    school_name: p.schools?.name ?? "",
    season_id: p.season_id,
    season_name: p.seasons?.name ?? null,
    status: p.status,
    start_date: p.start_date,
    end_date: p.end_date,
    capacity: p.capacity,
    enrolled: count.get(p.id) ?? 0,
    monthly_fee: Number(p.monthly_fee),
    times: (p.schedule_templates || [])
      .sort((a: any, b: any) => a.day_of_week - b.day_of_week)
      .map((t: any) => weeklyTime(t)),
    registration_open: p.registration_open,
    public_slug: p.public_slug,
  }));

  const sessionCount = new Map<string, number>();
  for (const r of rows) if (r.season_id) sessionCount.set(r.season_id, (sessionCount.get(r.season_id) ?? 0) + 1);

  return {
    programs: ((catalog.data || []) as any[]).map(
      (c): CatalogProgram => ({
        ...c,
        default_monthly_fee: Number(c.default_monthly_fee),
        sessions: rows.filter((r) => r.catalog_id === c.id),
      })
    ),
    seasons: ((seasons.data || []) as any[]).map((s): Season => ({ ...s, sessionCount: sessionCount.get(s.id) ?? 0 })),
    schools: (schools.data || []) as { id: string; name: string }[],
  };
}
