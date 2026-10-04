"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { createProgram } from "@/lib/actions/programs";
import { createScheduleTemplate } from "@/lib/actions/schedule";
import { createSchool } from "@/lib/actions/schools";

/**
 * Programs (made once), seasons, and sessions — a program at a school in a
 * season. See supabase/migrations/20261003001100_programs_sessions_seasons.sql
 * for how these map onto the tables.
 */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function refresh() {
  for (const p of ["/programs", "/schools", "/registrations", "/schedule"]) revalidatePath(p);
}

function money(v: string): number | null {
  if (v === "") return 0;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Create or update a program (the thing offered at schools). */
export async function saveCatalogProgram(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = s(form, "id");
  const fee = money(s(form, "default_monthly_fee"));
  const capacity = Math.round(Number(s(form, "default_capacity") || "12"));
  const row = {
    name: s(form, "name"),
    sport: s(form, "sport") || "basketball",
    description: s(form, "description"),
    age_groups: form.getAll("age_groups").map(String).filter(Boolean),
    default_monthly_fee: fee ?? 0,
    default_capacity: capacity,
    image: s(form, "image") || null,
  };
  if (!row.name) return { error: "Give the program a name." };
  if (fee === null) return { error: "The usual monthly fee should be an amount, like 120 — or 0 if it's free." };
  if (!(capacity > 0)) return { error: "How many children can join? Enter a number above 0." };
  const db = createAdminSupabase();
  const { data, error } = id
    ? await db.from("program_catalog").update(row).eq("id", id).select("id").single()
    : await db.from("program_catalog").insert(row).select("id").single();
  if (error) {
    return { error: error.code === "23505" ? `There's already a program called "${row.name}".` : error.message };
  }
  refresh();
  return { success: true as const, id: data.id as string };
}

/** Archive a program (it stays on its past sessions), or bring it back. */
export async function setCatalogProgramArchived(id: string, archived: boolean) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { error } = await createAdminSupabase()
    .from("program_catalog")
    .update({ status: archived ? "archived" : "active" })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true as const };
}

/** Create or update a season. Renaming one renames it on its sessions too. */
export async function saveSeason(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const id = s(form, "id");
  const status = s(form, "status");
  const noClass = s(form, "no_class_dates")
    .split(/[\s,]+/)
    .map(date)
    .filter((d): d is string => !!d);
  const row = {
    name: s(form, "name"),
    start_date: date(s(form, "start_date")),
    end_date: date(s(form, "end_date")),
    status: ["upcoming", "active", "closed"].includes(status) ? status : "active",
    no_class_dates: [...new Set(noClass)].sort(),
  };
  if (!row.name) return { error: "Name the season, like Fall 2026." };
  if (row.start_date && row.end_date && row.end_date < row.start_date) return { error: "The season ends before it starts." };
  const db = createAdminSupabase();
  const { data, error } = id
    ? await db.from("seasons").update(row).eq("id", id).select("id").single()
    : await db.from("seasons").insert(row).select("id").single();
  if (error) return { error: error.code === "23505" ? `There's already a season called "${row.name}".` : error.message };
  // Keep the old text column in step (see the migration).
  await db.from("programs").update({ season: row.name }).eq("season_id", data.id);
  refresh();
  return { success: true as const, id: data.id as string };
}

/**
 * Put a program on at a school: a session, with its first weekly time.
 * Makes the school or the season too, when they're new. The roster starts
 * empty — children come by import, sign-up, or "Who paid this?".
 */
export async function offerSession(form: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const db = createAdminSupabase();

  const { data: program } = await db.from("program_catalog").select("*").eq("id", s(form, "catalog_id")).maybeSingle();
  if (!program) return { error: "Pick the program." };

  // The school: chosen, or new (an existing name is the existing school).
  let schoolId = s(form, "school_id");
  const newSchool = s(form, "new_school_name");
  if (!schoolId && newSchool) {
    const { data: same } = await db.from("schools").select("id").ilike("name", newSchool.replace(/[\\%_]/g, (c) => `\\${c}`)).neq("status", "archived").maybeSingle();
    if (same) schoolId = same.id;
    else {
      const fd = new FormData();
      fd.set("name", newSchool);
      const made: any = await createSchool(fd);
      if (made?.error) return { error: made.error };
      const { data: school } = await db.from("schools").select("id").eq("name", newSchool).order("created_at", { ascending: false }).limit(1).maybeSingle();
      schoolId = school?.id ?? "";
    }
  }
  if (!schoolId) return { error: "Pick the school, or name a new one." };

  // The season: chosen, or new.
  let seasonId = s(form, "season_id");
  const newSeason = s(form, "new_season_name");
  if (!seasonId && newSeason) {
    const fd = new FormData();
    fd.set("name", newSeason);
    fd.set("start_date", s(form, "start_date"));
    fd.set("end_date", s(form, "end_date"));
    const made: any = await saveSeason(fd);
    if (made?.error) return { error: made.error };
    seasonId = made.id;
  }
  const { data: season } = seasonId ? await db.from("seasons").select("*").eq("id", seasonId).maybeSingle() : { data: null };

  const day = s(form, "day_of_week");
  const start = s(form, "start_time");
  const end = s(form, "end_time");
  if (day !== "" && (!start || !end)) return { error: "Give the practice a start and end time, or leave the day empty." };
  if (start && end && end <= start) return { error: "The practice ends before it starts." };

  const fd = new FormData();
  fd.set("school_id", schoolId);
  fd.set("name", program.name);
  fd.set("catalog_id", program.id);
  if (seasonId) fd.set("season_id", seasonId);
  fd.set("start_date", s(form, "start_date") || season?.start_date || "");
  fd.set("end_date", s(form, "end_date") || season?.end_date || "");
  fd.set("monthly_fee", s(form, "monthly_fee") || String(program.default_monthly_fee));
  fd.set("capacity", s(form, "capacity") || String(program.default_capacity));
  fd.set("status", season?.status === "upcoming" ? "upcoming" : "active");
  fd.set("registration_open", s(form, "registration_open") === "true" ? "true" : "false");
  fd.set("location", s(form, "location"));
  fd.set("public_description", program.description ?? "");
  fd.set("whatsapp_group_url", s(form, "whatsapp_group_url"));
  const made: any = await createProgram(fd);
  if (made?.error) return { error: made.error };
  const { data: session } = await db.from("programs").select("id").eq("public_slug", made.slug).single();

  if (day !== "") {
    const t = new FormData();
    t.set("program_id", session!.id);
    t.set("day_of_week", day);
    t.set("start_time", start);
    t.set("end_time", end);
    t.set("location", s(form, "location"));
    const tm: any = await createScheduleTemplate(t);
    if (tm?.error) return { error: `The session was made, but not its weekly time: ${tm.error}` };
  }

  refresh();
  revalidatePath(`/schools/${schoolId}`);
  return { success: true as const, sessionId: session!.id as string, schoolId, slug: made.slug as string };
}
