import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { admin, truncateAll } from "../helpers/db";
import { saveCatalogProgram, saveSeason, offerSession, setCatalogProgramArchived } from "@/lib/actions/catalog";
import { getProgramsPage, weeklyTime } from "@/lib/queries/catalog";

/**
 * Programs are made once; a session is a program at a school in a season,
 * and starts with an empty roster. Children come later.
 */

async function clean() {
  await truncateAll();
  await admin.from("program_catalog").delete().not("id", "is", null);
  await admin.from("seasons").delete().not("id", "is", null);
}
beforeEach(clean);
afterEach(clean);

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
}

async function program(name = "Lil Dribblers (K–1)") {
  const r: any = await saveCatalogProgram(form({ name, description: "Basketball basics", age_groups: ["4-6 years"], default_monthly_fee: "100", default_capacity: "12" }));
  expect(r.error).toBeUndefined();
  return r.id as string;
}

describe("programs", () => {
  it("are made once, with their usual fee and places, and names don't repeat", async () => {
    const id = await program();
    const { data } = await admin.from("program_catalog").select("name, sport, age_groups, default_monthly_fee, default_capacity, status").eq("id", id).single();
    expect(data).toEqual({ name: "Lil Dribblers (K–1)", sport: "basketball", age_groups: ["4-6 years"], default_monthly_fee: 100, default_capacity: 12, status: "active" });
    expect(((await saveCatalogProgram(form({ name: "  lil dribblers (k–1) " }))) as any).error).toMatch(/already a program/);
    expect(((await saveCatalogProgram(form({ name: "Free Clinic", default_monthly_fee: "abc" }))) as any).error).toMatch(/fee/);
    expect(((await saveCatalogProgram(form({ name: "Free Clinic", default_monthly_fee: "0" }))) as any).error).toBeUndefined();
  });
});

describe("putting a program on at a school", () => {
  it("makes a session with an empty roster, its weekly time, and the season's dates", async () => {
    const pid = await program();
    const season: any = await saveSeason(form({ name: "Fall 2026", start_date: "2026-09-08", end_date: "2026-12-11", status: "active", no_class_dates: "2026-11-26, 2026-11-27" }));
    const { data: school } = await admin.from("schools").insert({ name: "Lakehill Elementary" }).select("id").single();

    const r: any = await offerSession(form({ catalog_id: pid, school_id: school!.id, season_id: season.id, day_of_week: "2", start_time: "15:30", end_time: "16:30", location: "Gym", registration_open: "true" }));
    expect(r.error).toBeUndefined();

    const { data: s } = await admin
      .from("programs")
      .select("name, catalog_id, season_id, season, school_id, start_date, end_date, monthly_fee, capacity, registration_open, schedule_templates(day_of_week, start_time, end_time, location)")
      .eq("id", r.sessionId)
      .single();
    expect(s).toMatchObject({
      name: "Lil Dribblers (K–1)", catalog_id: pid, season_id: season.id, season: "Fall 2026", school_id: school!.id,
      start_date: "2026-09-08", end_date: "2026-12-11", monthly_fee: 100, capacity: 12, registration_open: true,
    });
    expect(s!.schedule_templates).toEqual([{ day_of_week: 2, start_time: "15:30:00", end_time: "16:30:00", location: "Gym" }]);
    const { count } = await admin.from("enrollments").select("*", { count: "exact", head: true }).eq("program_id", r.sessionId);
    expect(count).toBe(0);

    const page = await getProgramsPage();
    const listed = page.programs.find((p) => p.id === pid)!;
    expect(listed.sessions).toEqual([expect.objectContaining({ school_name: "Lakehill Elementary", season_name: "Fall 2026", enrolled: 0, times: ["Tue 3:30–4:30 PM"] })]);
    expect(page.seasons.find((x) => x.id === season.id)).toMatchObject({ sessionCount: 1, no_class_dates: ["2026-11-26", "2026-11-27"] });
  });

  it("makes a new school and season on the way — reusing a school that already has the name", async () => {
    const pid = await program();
    await admin.from("schools").insert({ name: "Oakwood Academy" });
    const a: any = await offerSession(form({ catalog_id: pid, new_school_name: "oakwood academy", new_season_name: "Spring 2027", start_date: "2027-01-12", end_date: "2027-05-14" }));
    expect(a.error).toBeUndefined();
    const { count: schools } = await admin.from("schools").select("*", { count: "exact", head: true }).ilike("name", "oakwood academy");
    expect(schools).toBe(1);
    const { data: season } = await admin.from("seasons").select("name, start_date").eq("name", "Spring 2027").single();
    expect(season).toEqual({ name: "Spring 2027", start_date: "2027-01-12" });

    const b: any = await offerSession(form({ catalog_id: pid, new_school_name: "Sunrise Montessori" }));
    expect(b.error).toBeUndefined();
    expect((await getProgramsPage()).programs.find((p) => p.id === pid)!.sessions).toHaveLength(2);
  });

  it("refuses what doesn't add up", async () => {
    const pid = await program();
    expect(((await offerSession(form({ catalog_id: pid }))) as any).error).toMatch(/school/);
    expect(((await offerSession(form({ catalog_id: pid, new_school_name: "X", day_of_week: "1", start_time: "16:00", end_time: "15:00" }))) as any).error).toMatch(/ends before/);
    expect(((await offerSession(form({ catalog_id: "00000000-0000-0000-0000-000000000000", new_school_name: "X" }))) as any).error).toMatch(/program/);
  });
});

describe("seasons", () => {
  it("renaming a season renames it on its sessions; dates must be in order", async () => {
    const pid = await program();
    const season: any = await saveSeason(form({ name: "Fall 26" }));
    const r: any = await offerSession(form({ catalog_id: pid, new_school_name: "Lakehill", season_id: season.id }));
    await saveSeason(form({ id: season.id, name: "Fall 2026" }));
    const { data } = await admin.from("programs").select("season").eq("id", r.sessionId).single();
    expect(data!.season).toBe("Fall 2026");
    expect(((await saveSeason(form({ name: "Bad", start_date: "2026-12-01", end_date: "2026-09-01" }))) as any).error).toMatch(/ends before/);
  });

  it("an archived program keeps its sessions", async () => {
    const pid = await program();
    const r: any = await offerSession(form({ catalog_id: pid, new_school_name: "Lakehill" }));
    await setCatalogProgramArchived(pid, true);
    const p = (await getProgramsPage()).programs.find((x) => x.id === pid)!;
    expect(p.status).toBe("archived");
    expect(p.sessions.map((s) => s.id)).toEqual([r.sessionId]);
  });
});

describe("weekly times", () => {
  it("read naturally, including across noon", () => {
    expect(weeklyTime({ day_of_week: 6, start_time: "11:00:00", end_time: "12:00:00" })).toBe("Sat 11 AM–12 PM");
    expect(weeklyTime({ day_of_week: 2, start_time: "15:30:00", end_time: "16:30:00" })).toBe("Tue 3:30–4:30 PM");
  });
});
