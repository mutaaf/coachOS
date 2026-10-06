import { describe, it, expect, afterEach } from "vitest";
import { admin, adminPublic, anonPublic, seedProgram, truncateAll } from "../helpers/db";
import { longestMeetingRun, youthCampCheck, validLicenseNumber, YOUTH_CAMP_BLOCKED } from "@/lib/youth-camp";
import { addSchool, campSessions, emptyDraft, stepProblems, toPayload, type FlowContext } from "@/lib/new-program";
import { createProgramEverywhere } from "@/lib/actions/new-program";
import { createScheduleTemplate } from "@/lib/actions/schedule";

/**
 * Tex. Health & Safety Code ch. 141: 5+ minors for 4+ consecutive days is a
 * youth camp, which needs a DSHS license Rising Stars doesn't hold. A session
 * meeting 4+ days in a row can't go on the website (a published listing, or
 * open for sign-ups) without a confirmed license number on file.
 */

const NAME = "Zz Camp Program";

afterEach(async () => {
  await adminPublic.from("programs").delete().like("title", "Zz Camp%");
  await truncateAll();
  await admin.from("program_catalog").delete().like("name", "Zz Camp%");
  await admin.from("seasons").delete().like("name", "Zz Camp%");
});

/* ------------------------------------------------------------------------- */
/* Detection, without a database                                             */
/* ------------------------------------------------------------------------- */

describe("detecting 4+ consecutive days", () => {
  it.each([
    [[1, 2, 3, 4], 4, true, "Mon–Thu"],
    [[1, 2, 3, 4, 5], 5, true, "Mon–Fri (camp week)"],
    [[1, 3], 1, false, "Mon/Wed"],
    [[1, 2, 3], 3, false, "Mon–Wed"],
    [[2, 4, 6], 1, false, "Tue/Thu/Sat"],
    [[6, 0, 1, 2], 4, true, "Sat–Tue, across the weekend"],
    [[5, 6, 0], 3, false, "Fri–Sun"],
  ])("%j → %i days (%s)", (days, longest, camp) => {
    const check = youthCampCheck({ days: days as number[] });
    expect(check.longest).toBe(longest);
    expect(check.looksLikeCamp).toBe(camp);
  });

  it("every day of the week, open-ended, never stops", () => {
    expect(youthCampCheck({ days: [0, 1, 2, 3, 4, 5, 6] }).longest).toBeGreaterThanOrEqual(7);
    expect(youthCampCheck({ days: [0, 1, 2, 3, 4, 5, 6] }).stretch).toBe("every day");
  });

  it("names the stretch", () => {
    expect(youthCampCheck({ days: [1, 2, 3, 4] }).stretch).toBe("Mon–Thu");
    expect(youthCampCheck({ days: [1, 2, 3, 4, 5], start: "2026-06-08", end: "2026-06-12" }).stretch).toBe("Jun 8–Jun 12");
  });

  it("a dated session counts only the days it actually runs", () => {
    // A camp week, Mon 8 – Fri 12 June.
    expect(youthCampCheck({ days: [1, 2, 3, 4, 5], start: "2026-06-08", end: "2026-06-12" }).looksLikeCamp).toBe(true);
    // Mon–Fri times, but the session is only Mon 8 – Wed 10: three days.
    expect(longestMeetingRun({ days: [1, 2, 3, 4, 5], start: "2026-06-08", end: "2026-06-10" })!.length).toBe(3);
    // Mon–Thu times, starting Thu 11 and ending Tue 16 June: Thu, then Mon–Tue.
    // Running on to Thu 18 makes a full Mon–Thu week.
    expect(longestMeetingRun({ days: [1, 2, 3, 4], start: "2026-06-11", end: "2026-06-16" })!.length).toBe(2);
    expect(longestMeetingRun({ days: [1, 2, 3, 4], start: "2026-06-11", end: "2026-06-18" })!.length).toBe(4);
  });

  it("dated practices (make-ups) next to the weekly ones count too", () => {
    // Mon/Wed weekly, plus make-ups on Tue 9 and Thu 11 June.
    expect(youthCampCheck({ days: [1, 3], dates: ["2026-06-09", "2026-06-11"] }).looksLikeCamp).toBe(true);
    expect(youthCampCheck({ days: [], dates: ["2026-06-08", "2026-06-09", "2026-06-10"] }).looksLikeCamp).toBe(false);
    expect(youthCampCheck({ days: [], dates: ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"] }).longest).toBe(4);
    expect(youthCampCheck({ days: [] }).looksLikeCamp).toBe(false);
  });

  it("matches the database's rule", async () => {
    const cases: [number[], string | null, string | null, string[]][] = [
      [[1, 2, 3, 4], null, null, []],
      [[6, 0, 1, 2], null, null, []],
      [[1, 3], null, null, []],
      [[1, 2, 3, 4, 5], "2026-06-08", "2026-06-10", []],
      [[1, 2, 3, 4], "2026-06-11", "2026-06-18", []],
      [[1, 3], null, null, ["2026-06-09", "2026-06-11"]],
      [[], null, null, ["2026-06-08", "2026-06-09", "2026-06-10"]],
    ];
    for (const [days, start, end, dates] of cases) {
      const { data, error } = await admin.rpc("longest_meeting_run", { p_dows: days, p_start: start, p_end: end, p_dates: dates });
      expect(error).toBeNull();
      const ts = longestMeetingRun({ days, start, end, dates })?.length ?? 0;
      expect(Math.min(data, 7), JSON.stringify([days, start, end, dates])).toBe(Math.min(ts, 7));
    }
  });

  it("a license number has to be something", () => {
    expect(validLicenseNumber("")).toBe(false);
    expect(validLicenseNumber("  ")).toBe(false);
    expect(validLicenseNumber("YC-12345")).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */
/* The New program flow                                                      */
/* ------------------------------------------------------------------------- */

const ctx = (): FlowContext => ({
  catalog: [],
  schools: [],
  seasons: [{ id: "summer", name: "Summer 2027", start_date: "2027-06-07", end_date: "2027-07-30", status: "upcoming" }],
  coaches: [],
  photos: [],
  sessions: [],
  today: "2026-10-05",
});

function campDraft(c: FlowContext) {
  let d = emptyDraft(c);
  d = {
    ...d,
    program: { mode: "new", name: NAME, sport: "basketball", ages: [], description: "", fee: "100", capacity: "12" },
    slots: [1, 2, 3, 4].map((dow) => ({ dow, start: "09:00", end: "12:00" })),
  };
  return d;
}

describe("the New program flow", () => {
  it("flags the sessions that meet 4+ days in a row and blocks publishing without a license", () => {
    const c = ctx();
    let d = addSchool(campDraft(c), { id: null, name: "Zz Camp School", address: "" });
    expect(campSessions(d, c).map((x) => x.name)).toEqual(["Zz Camp School"]);
    expect(stepProblems(d, c, "website")).toContain(`${YOUTH_CAMP_BLOCKED} Or turn off "Show on the website" and "Open for sign-ups now".`);

    // Ticked but no number.
    d = { ...d, youthCamp: { confirmed: true, number: "" } };
    expect(stepProblems(d, c, "website")).toContain("Enter the DSHS youth camp license number.");

    // Confirmed with a number: fine, and the number goes with the save.
    d = { ...d, youthCamp: { confirmed: true, number: "YC-0042" } };
    expect(stepProblems(d, c, "website")).toEqual([]);
    expect(toPayload(d).youth_camp_license).toEqual({ number: "YC-0042" });

    // Off the website and closed for sign-ups: nothing to block.
    const hidden = { ...d, youthCamp: { confirmed: false, number: "" }, registrationOpen: false, website: { ...d.website, show: false } };
    expect(stepProblems(hidden, c, "website")).toEqual([]);
    expect(toPayload(hidden).youth_camp_license).toBeUndefined();
  });

  it("a school with its own Mon/Wed times isn't a camp even if the shared schedule is", () => {
    const c = ctx();
    let d = addSchool(campDraft(c), { id: null, name: "Zz Camp A", address: "" });
    d = addSchool(d, { id: null, name: "Zz Camp B", address: "" });
    d.schools[1] = { ...d.schools[1], slots: [{ dow: 1, start: "15:00", end: "16:00" }, { dow: 3, start: "15:00", end: "16:00" }] };
    expect(campSessions(d, c).map((x) => x.name)).toEqual(["Zz Camp A"]);
  });

  it("the save refuses an unlicensed camp, and keeps a confirmed license on each session", async () => {
    const c = { ...ctx(), seasons: [] };
    let d = addSchool(campDraft(c), { id: null, name: "Zz Camp School", address: "" });
    d = { ...d, season: { mode: "none" } };
    expect(await createProgramEverywhere(d)).toEqual({ error: expect.stringContaining("youth camp") });

    // The database refuses too, whatever the page sent.
    const { error } = await admin.rpc("create_program_sessions", { p: toPayload(d) });
    expect(error?.message).toBe(YOUTH_CAMP_BLOCKED);
    const { count } = await admin.from("programs").select("id", { count: "exact", head: true });
    expect(count).toBe(0);

    d = { ...d, youthCamp: { confirmed: true, number: "YC-0042" } };
    const res = await createProgramEverywhere(d);
    expect(res).toMatchObject({ success: true });
    const { data: rows } = await admin
      .from("programs")
      .select("youth_camp_license_number, youth_camp_license_confirmed_at, youth_camp_license_confirmed_by")
      .in("id", (res as any).created.sessions.map((s: any) => s.id));
    expect(rows).toEqual([
      { youth_camp_license_number: "YC-0042", youth_camp_license_confirmed_at: expect.any(String), youth_camp_license_confirmed_by: "00000000-0000-0000-0000-00000000b055" },
    ]);
    const { data: site } = await anonPublic.from("site_offerings").select("offering_id").in("offering_id", (res as any).created.sessions.map((s: any) => s.id));
    expect(site).toHaveLength(1);
  });

  it("an unlicensed camp can still be saved off the website", async () => {
    const c = { ...ctx(), seasons: [] };
    let d = addSchool(campDraft(c), { id: null, name: "Zz Camp School", address: "" });
    d = { ...d, season: { mode: "none" }, registrationOpen: false, website: { ...d.website, show: false } };
    expect(await createProgramEverywhere(d)).toMatchObject({ success: true });
  });
});

/* ------------------------------------------------------------------------- */
/* Every other way onto the website                                          */
/* ------------------------------------------------------------------------- */

async function templates(programId: string, days: number[]) {
  return admin
    .from("schedule_templates")
    .insert(days.map((day_of_week) => ({ program_id: programId, day_of_week, start_time: "09:00", end_time: "12:00" })));
}

describe("the publish block", () => {
  it("a weekly time that makes a session on the website a camp is refused; Mon/Wed is fine", async () => {
    const { programId } = await seedProgram({ registrationOpen: true });
    expect((await templates(programId, [1, 3])).error).toBeNull();
    expect((await templates(programId, [2])).error).toBeNull();
    const { error } = await templates(programId, [4]);
    expect(error?.message).toBe(YOUTH_CAMP_BLOCKED);
  });

  it("the schedule editor saves the confirmed license first, then the time", async () => {
    const { programId } = await seedProgram({ registrationOpen: true });
    await templates(programId, [1, 2, 3]);
    const form = (extra: Record<string, string> = {}) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ program_id: programId, day_of_week: "4", start_time: "09:00", end_time: "12:00", ...extra })) f.set(k, v);
      return f;
    };
    expect(await createScheduleTemplate(form())).toEqual({ error: YOUTH_CAMP_BLOCKED });
    expect(await createScheduleTemplate(form({ youth_camp_license_confirmed: "on", youth_camp_license_number: "" }))).toEqual({
      error: "Enter the DSHS youth camp license number.",
    });
    expect(await createScheduleTemplate(form({ youth_camp_license_confirmed: "on", youth_camp_license_number: "YC-77" }))).toMatchObject({ data: expect.any(Object) });
    const { data: p } = await admin.from("programs").select("youth_camp_license_number").eq("id", programId).single();
    expect(p!.youth_camp_license_number).toBe("YC-77");
  });

  it("a camp off the website can't be opened for sign-ups or given a published listing", async () => {
    const { programId } = await seedProgram({ registrationOpen: false });
    expect((await templates(programId, [1, 2, 3, 4, 5])).error).toBeNull();

    const { error: openError } = await admin.from("programs").update({ registration_open: true }).eq("id", programId);
    expect(openError?.message).toBe(YOUTH_CAMP_BLOCKED);

    const listing = { title: "Zz Camp Listing", description: "x", date_range: "", location: "", image: "", slots: "", price: "", age_groups: [], type: "current", ops_program_id: programId };
    const { error: listError } = await adminPublic.from("programs").insert({ ...listing, published: true });
    expect(listError?.message).toBe(YOUTH_CAMP_BLOCKED);

    // Unpublished is fine — and publishing it later is what's refused.
    const { data: draft, error: draftError } = await adminPublic.from("programs").insert({ ...listing, published: false }).select("id").single();
    expect(draftError).toBeNull();
    const { error: pubError } = await adminPublic.from("programs").update({ published: true }).eq("id", draft!.id);
    expect(pubError?.message).toBe(YOUTH_CAMP_BLOCKED);

    // With a license on file, both go through.
    await admin.from("programs").update({ youth_camp_license_number: "YC-1", youth_camp_license_confirmed_at: new Date().toISOString() }).eq("id", programId);
    expect((await adminPublic.from("programs").update({ published: true }).eq("id", draft!.id)).error).toBeNull();
    expect((await admin.from("programs").update({ registration_open: true }).eq("id", programId)).error).toBeNull();

    // And the license can't then be cleared while it's on the website.
    const { error: clearError } = await admin.from("programs").update({ youth_camp_license_number: null }).eq("id", programId);
    expect(clearError?.message).toBe(YOUTH_CAMP_BLOCKED);
  });

  it("closing sign-ups on a session is never blocked", async () => {
    const { programId } = await seedProgram({ registrationOpen: false });
    await templates(programId, [1, 2, 3, 4]);
    await admin.from("programs").update({ youth_camp_license_number: "YC-1" }).eq("id", programId);
    await admin.from("programs").update({ registration_open: true }).eq("id", programId);
    expect((await admin.from("programs").update({ registration_open: false }).eq("id", programId)).error).toBeNull();
  });
});
