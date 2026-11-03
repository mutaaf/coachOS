import { describe, it, expect, afterEach } from "vitest";
import { admin, adminPublic, anonPublic, register, seedProgram, truncateAll } from "../helpers/db";

/**
 * What the website lists comes from CoachOS: one row per published session,
 * with the price, places, dates, venue and weekly times CoachOS holds, and the
 * listing's words and picture laid over the top.
 */

const listings: string[] = [];
const catalogs: string[] = [];
const seasons: string[] = [];

afterEach(async () => {
  if (listings.length) await adminPublic.from("programs").delete().in("id", listings.splice(0));
  await truncateAll();
  if (catalogs.length) await admin.from("program_catalog").delete().in("id", catalogs.splice(0));
  if (seasons.length) await admin.from("seasons").delete().in("id", seasons.splice(0));
});

async function offering(id: string) {
  const { data, error } = await anonPublic.from("site_offerings").select("*").eq("offering_id", id).maybeSingle();
  expect(error).toBeNull();
  return data as Record<string, any> | null;
}

async function listing(opsProgramId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await adminPublic
    .from("programs")
    .insert({
      title: "Overlay title", description: "Overlay words", date_range: "", location: "", image: "/pic.png",
      slots: "", price: "", age_groups: [], type: "current", ops_program_id: opsProgramId, ...fields,
    })
    .select("id")
    .single();
  if (error) throw error;
  listings.push(data.id);
  return data.id as string;
}

describe("site_offerings", () => {
  it("lists an open session with CoachOS's own fee, places, season, venue and weekly times", async () => {
    const { programId, schoolId } = await seedProgram({ capacity: 3, monthlyFee: 120 });
    const { data: cat } = await admin
      .from("program_catalog")
      .insert({ name: `Lil Dribblers ${Date.now()}`, sport: "basketball", age_groups: ["K-1"], description: "Catalog words", image: "/cat.png" })
      .select("id")
      .single();
    catalogs.push(cat!.id);
    const { data: season } = await admin
      .from("seasons")
      .insert({ name: `Fall ${Date.now()}`, start_date: "2026-09-01", end_date: "2026-12-15" })
      .select("id, name")
      .single();
    seasons.push(season!.id);
    await admin.from("schools").update({ address: "1 School Way, Wylie TX" }).eq("id", schoolId);
    await admin
      .from("programs")
      .update({ catalog_id: cat!.id, season_id: season!.id, notes: "private", whatsapp_group_url: "https://chat.whatsapp.com/abc" })
      .eq("id", programId);
    await admin.from("schedule_templates").insert([
      { program_id: programId, day_of_week: 4, start_time: "16:00", end_time: "17:00" },
      { program_id: programId, day_of_week: 2, start_time: "15:30", end_time: "16:30" },
    ]);
    await register(programId, "Amina");

    const o = await offering(programId);
    expect(o).toMatchObject({
      cms_program_id: null,
      description: "Catalog words",
      image_url: "/cat.png",
      sport: "basketball",
      age_groups: ["K-1"],
      season_name: season!.name,
      start_date: "2026-09-01",
      end_date: "2026-12-15",
      monthly_fee: 120,
      billing_period: "month",
      capacity: 3,
      seats_remaining: 2,
      waitlist_count: 0,
      registration_open: true,
      status: "active",
      venue_address: "1 School Way, Wylie TX",
      venue_city: null,
      featured: false,
      sort_order: 0,
      schedule: [
        { dow: 2, start: "15:30", end: "16:30" },
        { dow: 4, start: "16:00", end: "17:00" },
      ],
    });
    expect(o!.title).toMatch(/^Test Program/);
    expect(o!.venue_name).toMatch(/^Test School/);
    expect(JSON.stringify(o)).not.toMatch(/whatsapp|private|Amina/);
  });

  it("lays the linked listing's words, picture, order and address over the session", async () => {
    const { programId, slug } = await seedProgram();
    const id = await listing(programId, { featured: true, sort_order: 2, age_groups: ["7-9 years"] });
    let o = await offering(programId);
    expect(o).toMatchObject({
      cms_program_id: id, title: "Overlay title", description: "Overlay words", image_url: "/pic.png",
      featured: true, sort_order: 2, age_groups: ["7-9 years"], public_slug: slug,
    });

    await adminPublic.from("programs").update({ slug: "lil-dribblers-wylie" }).eq("id", id);
    o = await offering(programId);
    expect(o!.public_slug).toBe("lil-dribblers-wylie");
  });

  it("shows only what's published and still running", async () => {
    // Unlinked: listed while registration is open.
    const closed = await seedProgram({ registrationOpen: false });
    expect(await offering(closed.programId)).toBeNull();

    // Linked: the listing decides, open or not.
    const linkedClosed = await seedProgram({ registrationOpen: false });
    const id = await listing(linkedClosed.programId);
    expect((await offering(linkedClosed.programId))!.registration_open).toBe(false);
    await adminPublic.from("programs").update({ published: false }).eq("id", id);
    expect(await offering(linkedClosed.programId)).toBeNull();

    // A finished session is gone, linked or not.
    const done = await seedProgram();
    await listing(done.programId);
    await admin.from("programs").update({ status: "completed" }).eq("id", done.programId);
    expect(await offering(done.programId)).toBeNull();
  });

  it("counts the waitlist and never goes below zero places", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await register(programId, "One");
    await register(programId, "Two");
    expect(await offering(programId)).toMatchObject({ seats_remaining: 0, waitlist_count: 1 });
  });
});
