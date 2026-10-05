import { describe, it, expect, afterEach } from "vitest";
import { admin, adminPublic, anonPublic, truncateAll } from "../helpers/db";
import { signedOut } from "../helpers/auth";
import { NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createProgramEverywhere, setRegistrationOpen } from "@/lib/actions/new-program";
import {
  addSchool,
  cardPreview,
  defaultSeasonId,
  draftForNextSeason,
  draftForProgram,
  emptyDraft,
  nextSeasonName,
  problems,
  searchSchools,
  seasonNameFor,
  slotText,
  stepProblems,
  toPayload,
  warnings,
  type Draft,
  type FlowContext,
} from "@/lib/new-program";

/**
 * "Make it easy for me to create programs and assign to schools."
 *
 * The New program flow saves a program, its season, a session at each school
 * with its weekly times and coach, and the website cards — all in one
 * transaction. These pin the flow's defaults and checks (plain functions) and
 * the save itself against the database: everything appears, or nothing does.
 */

const NAME = "Zz Test Program";

afterEach(async () => {
  await adminPublic.from("programs").delete().like("title", `${NAME}%`);
  await truncateAll();
  await admin.from("site_media").delete().like("original_filename", "new-program-test%");
  await admin.from("program_catalog").delete().like("name", `${NAME}%`);
  await admin.from("seasons").delete().like("name", "Zz %");
});

/* ------------------------------------------------------------------------- */
/* The flow's logic, without a database                                      */
/* ------------------------------------------------------------------------- */

const ctx = (over: Partial<FlowContext> = {}): FlowContext => ({
  catalog: [
    { id: "c1", name: "Lil Dribblers", sport: "basketball", description: "Ball skills", age_groups: ["4-6 years"], default_monthly_fee: 100, default_capacity: 12, status: "active" },
    { id: "c2", name: "Old Program", sport: "soccer", description: "", age_groups: [], default_monthly_fee: 90, default_capacity: 10, status: "archived" },
  ],
  schools: [
    { id: "s1", name: "Lakehill Elementary", address: "1 Main St, Wylie", usualSlots: [{ dow: 2, start: "15:30", end: "16:30" }] },
    { id: "s2", name: "Oak Prep", address: null, usualSlots: [{ dow: 4, start: "16:00", end: "17:00" }] },
    { id: "s3", name: "Birch Academy", address: "9 Birch Rd", usualSlots: [] },
  ],
  seasons: [
    { id: "fall", name: "Fall 2026", start_date: "2026-09-08", end_date: "2026-12-11", status: "active" },
    { id: "spring", name: "Spring 2027", start_date: "2027-01-12", end_date: "2027-05-14", status: "upcoming" },
    { id: "old", name: "Spring 2026", start_date: "2026-01-10", end_date: "2026-05-10", status: "closed" },
  ],
  coaches: [{ id: "k1", name: "Coach Kim" }],
  photos: [{ id: "m1", url: "https://x/m1.jpg", thumb: "https://x/m1-480.webp", alt: "Kids dribbling", focal_x: 0.5, focal_y: 0.3, live: true }],
  sessions: [],
  today: "2026-10-05",
  ...over,
});

describe("defaults", () => {
  it("starts in the season her latest session went into, else the current one", () => {
    expect(defaultSeasonId(ctx())).toBe("fall");
    const c = ctx({
      sessions: [
        { id: "a", catalog_id: "c1", school_id: "s1", season_id: "fall", monthly_fee: 100, capacity: 12, location: null, coach_id: null, slots: [], registration_open: true, created_at: "2026-08-01T00:00:00Z" },
        { id: "b", catalog_id: "c1", school_id: "s2", season_id: "spring", monthly_fee: 100, capacity: 12, location: null, coach_id: null, slots: [], registration_open: true, created_at: "2026-10-01T00:00:00Z" },
      ],
    });
    expect(defaultSeasonId(c)).toBe("spring");
    // A closed season is never the default, even if it was the last one used.
    expect(defaultSeasonId({ ...c, sessions: [{ ...c.sessions[0], season_id: "old", created_at: "2026-12-01T00:00:00Z" }] })).toBe("fall");
  });

  it("suggests a new season's name when there are none", () => {
    const d = emptyDraft(ctx({ seasons: [] }));
    expect(d.season).toEqual({ mode: "new", name: "Fall 2026", start: "", end: "" });
    expect(seasonNameFor("2027-02-01")).toBe("Spring 2027");
    expect(seasonNameFor("2027-06-15")).toBe("Summer 2027");
  });

  it("opens registration and shows it on the website unless she says otherwise", () => {
    const d = emptyDraft(ctx());
    expect(d.registrationOpen).toBe(true);
    expect(d.website.show).toBe(true);
  });

  it("takes the first school's usual time as the schedule, and keeps another school's own usual time", () => {
    let d = emptyDraft(ctx());
    d = addSchool(d, ctx().schools[0]);
    expect(d.slots).toEqual([{ dow: 2, start: "15:30", end: "16:30" }]);
    d = addSchool(d, ctx().schools[1]);
    expect(d.schools[1].slots).toEqual([{ dow: 4, start: "16:00", end: "17:00" }]);
    // A school with no history follows the shared schedule.
    d = addSchool(d, ctx().schools[2]);
    expect(d.schools[2].slots).toBeNull();
    // The same school twice is once.
    expect(addSchool(d, ctx().schools[0]).schools).toHaveLength(3);
  });

  it("finds schools by name or address, leaving out ones already picked", () => {
    const d = addSchool(emptyDraft(ctx()), ctx().schools[0]);
    expect(searchSchools(ctx().schools, "birch", d.schools).map((s) => s.id)).toEqual(["s3"]);
    expect(searchSchools(ctx().schools, "main st", d.schools)).toEqual([]);
    expect(searchSchools(ctx().schools, "", d.schools).map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("names the season after this one", () => {
    expect(nextSeasonName("Fall 2026")).toBe("Spring 2027");
    expect(nextSeasonName("Spring 2027")).toBe("Summer 2027");
    expect(nextSeasonName("summer 2027")).toBe("Fall 2027");
    expect(nextSeasonName("Winter 2027")).toBe("Spring 2027");
    expect(nextSeasonName("Term 3")).toBeNull();
  });

  it("writes weekly times the way the Programs page does", () => {
    expect(slotText({ dow: 2, start: "15:30", end: "16:30" })).toBe("Tue 3:30–4:30 PM");
    expect(slotText({ dow: 6, start: "11:00", end: "12:30" })).toBe("Sat 11 AM–12:30 PM");
  });
});

describe("follow-ups", () => {
  const sessions: FlowContext["sessions"] = [
    { id: "a", catalog_id: "c1", school_id: "s1", season_id: "fall", monthly_fee: 100, capacity: 12, location: "Gym", coach_id: "k1", slots: [{ dow: 2, start: "15:30", end: "16:30" }], registration_open: true, created_at: "2026-08-01T00:00:00Z" },
    { id: "b", catalog_id: "c1", school_id: "s2", season_id: "fall", monthly_fee: 120, capacity: 8, location: null, coach_id: null, slots: [{ dow: 4, start: "16:00", end: "17:00" }], registration_open: true, created_at: "2026-08-02T00:00:00Z" },
  ];

  it("Add to another school starts from the program and its usual times", () => {
    const d = draftForProgram(ctx({ sessions }), "c1");
    expect(d.program).toEqual({ mode: "existing", id: "c1" });
    expect(d.slots).toEqual([{ dow: 4, start: "16:00", end: "17:00" }]);
    expect(d.schools).toEqual([]);
  });

  it("Duplicate for next season copies schools, fees, places, coach and times into the next season", () => {
    const d = draftForNextSeason(ctx({ sessions }), "c1", "fall");
    expect(d.season).toEqual({ mode: "existing", id: "spring" });
    expect(d.slots).toEqual([{ dow: 2, start: "15:30", end: "16:30" }]);
    expect(d.schools.map((s) => [s.id, s.fee, s.capacity, s.coachId, s.location, s.slots])).toEqual([
      ["s1", "100", "12", "k1", "Gym", null],
      ["s2", "120", "8", "", "", [{ dow: 4, start: "16:00", end: "17:00" }]],
    ]);
    expect(problems(d, ctx({ sessions }))).toEqual([]);
  });

  it("Duplicate for next season names a new season when the next one doesn't exist yet", () => {
    const c = ctx({ sessions, seasons: ctx().seasons.filter((s) => s.id !== "spring") });
    expect(draftForNextSeason(c, "c1", "fall").season).toEqual({ mode: "new", name: "Spring 2027", start: "", end: "" });
  });

  it("warns when the program is already on at a school that season", () => {
    let d = draftForProgram(ctx({ sessions }), "c1");
    d = addSchool(d, ctx().schools[0]);
    expect(warnings(d, ctx({ sessions }))).toContain("It's already on at Lakehill Elementary this season — this adds a second session there.");
  });
});

describe("checks", () => {
  const ready = (): Draft => {
    let d = emptyDraft(ctx());
    d = { ...d, program: { mode: "new", name: "Hoops", sport: "basketball", ages: ["7-9 years"], description: "Fun", fee: "110", capacity: "10" } };
    d = addSchool(d, ctx().schools[0]);
    return d;
  };

  it("passes a complete draft", () => {
    expect(problems(ready(), ctx())).toEqual([]);
  });

  it("says what's missing, step by step, in plain words", () => {
    const d = emptyDraft(ctx());
    expect(stepProblems(d, ctx(), "program")).toEqual(["Give the program a name."]);
    expect(stepProblems(d, ctx(), "where")).toEqual(["Pick at least one school."]);
    expect(stepProblems({ ...ready(), program: { mode: "new", name: "lil dribblers", sport: "", ages: [], description: "", fee: "", capacity: "" } }, ctx(), "program")).toEqual([
      'There\'s already a program called "lil dribblers". Pick it from the list instead.',
    ]);
    expect(stepProblems({ ...ready(), program: { mode: "existing", id: "c2" } }, ctx(), "program")[0]).toMatch(/archived/);
    const bad = { ...ready(), program: { mode: "new" as const, name: "X", sport: "", ages: [], description: "", fee: "abc", capacity: "0" } };
    expect(stepProblems(bad, ctx(), "program")).toHaveLength(2);
    expect(stepProblems({ ...ready(), slots: [{ dow: 2, start: "16:30", end: "15:30" }] }, ctx(), "where")[0]).toMatch(/ends before it starts/);
    expect(stepProblems({ ...ready(), season: { mode: "existing", id: "old" } }, ctx(), "where")[0]).toMatch(/closed/);
    expect(stepProblems({ ...ready(), startDate: "2026-12-01", endDate: "2026-11-01" }, ctx(), "where")).toContain("The end date is before the start date.");
    const fee = { ...ready(), schools: [{ ...ready().schools[0], fee: "-5" }] };
    expect(stepProblems(fee, ctx(), "where")).toEqual(["The fee at Lakehill Elementary should be an amount, like 120."]);
  });
});

describe("the payload and the preview", () => {
  it("sends overrides only where she changed them, and the season by id", () => {
    let d = emptyDraft(ctx());
    d = { ...d, program: { mode: "existing", id: "c1" } };
    d = addSchool(d, ctx().schools[0]);
    d = addSchool(d, { id: null, name: " New School ", address: " 5 Elm St " });
    d.schools[1] = { ...d.schools[1], fee: "$95", capacity: "8", coachId: "k1" };
    d = { ...d, website: { ...d.website, mediaId: "m1" } };
    expect(toPayload(d)).toEqual({
      program: { id: "c1" },
      season: { id: "fall" },
      start_date: null,
      end_date: null,
      slots: [{ dow: 2, start: "15:30", end: "16:30" }],
      location: null,
      registration_open: true,
      sessions: [
        { school: { id: "s1" }, monthly_fee: null, capacity: null, coach_id: null, location: null, slots: null },
        { school: { name: "New School", address: "5 Elm St" }, monthly_fee: 95, capacity: 8, coach_id: "k1", location: null, slots: null },
      ],
      website: { show: true, title: null, description: null, media_id: "m1", featured: false },
    });
  });

  it("previews the website card from the program, the season and each school", () => {
    let d = emptyDraft(ctx());
    d = { ...d, program: { mode: "existing", id: "c1" }, website: { ...d.website, mediaId: "m1" } };
    d = addSchool(d, ctx().schools[0]);
    d = addSchool(d, ctx().schools[1]);
    d.schools[1] = { ...d.schools[1], fee: "120" };
    const card = cardPreview(d, ctx());
    expect(card).toMatchObject({
      title: "Lil Dribblers",
      description: "Ball skills",
      ages: ["4-6 years"],
      dates: "September 8 – December 11, 2026",
      sport: "basketball",
      registrationOpen: true,
    });
    expect(card.photo?.id).toBe("m1");
    expect(card.places).toEqual([
      { school: "Lakehill Elementary", times: "Tue 3:30–4:30 PM", price: "$100/month", spots: "12 spots" },
      { school: "Oak Prep", times: "Thu 4–5 PM", price: "$120/month", spots: "12 spots" },
    ]);
  });
});

/* ------------------------------------------------------------------------- */
/* The save, against the database                                            */
/* ------------------------------------------------------------------------- */

async function school(name: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("schools").insert({ name, status: "active", ...fields }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function livePhoto() {
  const { data, error } = await admin
    .from("site_media")
    .insert({
      status: "ready",
      url: "http://127.0.0.1/photo.jpg",
      srcset: [{ w: 480, url: "http://127.0.0.1/photo-480.webp" }, { w: 960, url: "http://127.0.0.1/photo-960.webp" }],
      alt: "Children dribbling in a gym",
      published: true,
      original_filename: "new-program-test.jpg",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function liveContext(over: Partial<FlowContext>): FlowContext {
  return { catalog: [], schools: [], seasons: [], coaches: [], photos: [], sessions: [], today: "2026-10-05", ...over };
}

describe("createProgramEverywhere", () => {
  it("puts a new program on at two schools, with its season, times, coach and website cards, in one save", async () => {
    const lakehill = await school("Zz Lakehill", { address: "1 Main St, Wylie TX" });
    const { data: coach } = await admin.from("coaches").insert({ first_name: "Kim", last_name: "Coach", phone: "+12145550101" }).select("id").single();
    const photo = await livePhoto();

    let d = emptyDraft(liveContext({ seasons: [] }));
    d = {
      ...d,
      program: { mode: "new", name: NAME, sport: "Basketball", ages: ["4-6 years"], description: "Ball skills and fun.", fee: "100", capacity: "10" },
      season: { mode: "new", name: "Zz Fall 2026", start: "2026-09-08", end: "2026-12-11" },
      slots: [
        { dow: 4, start: "15:30", end: "16:30" },
        { dow: 2, start: "15:30", end: "16:30" },
      ],
      website: { show: true, title: "", description: "", mediaId: photo, featured: false },
    };
    d = addSchool(d, { id: lakehill, name: "Zz Lakehill", address: "1 Main St, Wylie TX", usualSlots: [] });
    d = addSchool(d, { id: null, name: "Zz Oak Prep", address: "2 Oak Ave, Plano TX" });
    d.schools[1] = { ...d.schools[1], fee: "120", capacity: "8", coachId: coach!.id, slots: [{ dow: 1, start: "16:00", end: "17:00" }] };

    const res = await createProgramEverywhere(d);
    expect(res).toMatchObject({ success: true });
    const created = (res as any).created;
    expect(created.sessions).toHaveLength(2);

    const { data: sessions } = await admin
      .from("programs")
      .select("id, name, monthly_fee, capacity, registration_open, status, season, public_slug, schools(name, address), schedule_templates(day_of_week, start_time, coach_id)")
      .eq("catalog_id", created.catalog_id)
      .order("monthly_fee");
    expect(sessions!.map((s: any) => [s.schools.name, Number(s.monthly_fee), s.capacity, s.registration_open, s.status, s.season])).toEqual([
      ["Zz Lakehill", 100, 10, true, "active", "Zz Fall 2026"],
      ["Zz Oak Prep", 120, 8, true, "active", "Zz Fall 2026"],
    ]);
    expect((sessions![0] as any).schedule_templates.map((t: any) => t.day_of_week).sort()).toEqual([2, 4]);
    expect((sessions![1] as any).schedule_templates).toEqual([{ day_of_week: 1, start_time: "16:00:00", coach_id: coach!.id }]);
    expect((sessions![1] as any).schools.address).toBe("2 Oak Ave, Plano TX");
    expect(sessions![0].public_slug).toBe("zz-lakehill-zz-test-program");

    // On the website: what a stranger with the anon key sees.
    const { data: site } = await anonPublic
      .from("site_offerings")
      .select("offering_id, title, description, image_url, sport, monthly_fee, capacity, venue_name, venue_address, registration_open, schedule")
      .in("offering_id", created.sessions.map((s: any) => s.id))
      .order("monthly_fee");
    expect(site).toHaveLength(2);
    expect(site![0]).toMatchObject({
      title: NAME,
      description: "Ball skills and fun.",
      image_url: "http://127.0.0.1/photo-960.webp",
      sport: "basketball",
      monthly_fee: 100,
      venue_address: "1 Main St, Wylie TX",
      registration_open: true,
    });
    expect(site![1]).toMatchObject({ venue_name: "Zz Oak Prep", monthly_fee: 120, capacity: 8, schedule: [{ dow: 1, start: "16:00", end: "17:00" }] });
    const { data: listings } = await adminPublic.from("programs").select("published, price, ops_program_id").like("title", `${NAME}%`);
    expect(listings!.map((l) => l.published)).toEqual([true, true]);
    expect(listings!.map((l) => l.price).sort()).toEqual(["$100/month", "$120/month"]);
  });

  it("saves nothing at all when one school can't be used", async () => {
    const archived = await school("Zz Closed School", { status: "archived" });
    let d = emptyDraft(liveContext({ seasons: [] }));
    d = {
      ...d,
      program: { mode: "new", name: NAME, sport: "soccer", ages: [], description: "", fee: "90", capacity: "" },
      season: { mode: "new", name: "Zz Spring 2027", start: "", end: "" },
      slots: [{ dow: 3, start: "15:00", end: "16:00" }],
    };
    d = addSchool(d, { id: null, name: "Zz Brand New School", address: "" });
    d = addSchool(d, { id: archived, name: "Zz Closed School", address: null, usualSlots: [] });

    const res = await createProgramEverywhere(d);
    expect(res).toEqual({ error: "Zz Closed School is archived. Bring it back on the Schools page first." });
    // Not the program, not the season, not the first school, not its session.
    expect((await admin.from("program_catalog").select("id").eq("name", NAME)).data).toEqual([]);
    expect((await admin.from("seasons").select("id").eq("name", "Zz Spring 2027")).data).toEqual([]);
    expect((await admin.from("schools").select("id").eq("name", "Zz Brand New School")).data).toEqual([]);
    expect((await admin.from("programs").select("id").eq("name", NAME)).data).toEqual([]);
    expect((await adminPublic.from("programs").select("id").like("title", `${NAME}%`)).data).toEqual([]);
  });

  it("adds an existing program at another school, reusing a school typed by name", async () => {
    const { data: cat } = await admin
      .from("program_catalog")
      .insert({ name: NAME, sport: "basketball", default_monthly_fee: 75, default_capacity: 9, description: "Catalog words" })
      .select("id")
      .single();
    await school("Zz Maple Elementary");
    let d = emptyDraft(liveContext({ seasons: [] }));
    d = { ...d, program: { mode: "existing", id: cat!.id }, season: { mode: "none" }, website: { ...d.website, show: false } };
    d = addSchool(d, { id: null, name: "zz maple  elementary", address: "7 Maple Dr" });
    const res = await createProgramEverywhere(d);
    expect(res).toMatchObject({ success: true });
    const { data: schools } = await admin.from("schools").select("name, address").ilike("name", "zz maple%");
    expect(schools).toEqual([{ name: "Zz Maple Elementary", address: "7 Maple Dr" }]);
    const { data: s } = await admin.from("programs").select("monthly_fee, capacity, registration_open, public_description").eq("catalog_id", cat!.id).single();
    expect(s).toEqual({ monthly_fee: 75, capacity: 9, registration_open: true, public_description: "Catalog words" });
    // Not shown on the website: no listing, and (registration open, no listing) it follows the old rule.
    expect((await adminPublic.from("programs").select("id").like("title", `${NAME}%`)).data).toEqual([]);
  });

  it("refuses a new program with a name that's taken, and anyone signed out", async () => {
    await admin.from("program_catalog").insert({ name: NAME });
    let d = emptyDraft(liveContext({ seasons: [] }));
    d = { ...d, program: { mode: "new", name: NAME.toUpperCase(), sport: "", ages: [], description: "", fee: "", capacity: "" }, season: { mode: "none" } };
    d = addSchool(d, { id: null, name: "Zz Somewhere", address: "" });
    expect(await createProgramEverywhere(d)).toEqual({ error: `There's already a program called "${NAME.toUpperCase()}". Pick it from the list instead.` });
    expect(await signedOut(() => createProgramEverywhere(d))).toEqual(NOT_SIGNED_IN);
    expect((await admin.from("schools").select("id").eq("name", "Zz Somewhere")).data).toEqual([]);
  });
});

describe("setRegistrationOpen", () => {
  it("opens and closes sign-ups on several sessions at once", async () => {
    const a = await school("Zz A");
    const b = await school("Zz B");
    const { data } = await admin
      .from("programs")
      .insert([
        { school_id: a, name: NAME, registration_open: true, public_slug: `zz-a-${Date.now()}` },
        { school_id: b, name: NAME, registration_open: true, public_slug: `zz-b-${Date.now()}` },
      ])
      .select("id");
    const ids = data!.map((r) => r.id);
    expect(await setRegistrationOpen(ids, false)).toEqual({ success: true, count: 2 });
    expect((await admin.from("programs").select("registration_open").in("id", ids)).data).toEqual([
      { registration_open: false },
      { registration_open: false },
    ]);
    expect(await setRegistrationOpen([], true)).toEqual({ error: "Pick at least one session." });
    expect(await signedOut(() => setRegistrationOpen(ids, true))).toEqual(NOT_SIGNED_IN);
  });
});
