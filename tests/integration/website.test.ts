import { describe, it, expect, afterEach } from "vitest";
import { adminPublic, seedProgram, truncateAll } from "../helpers/db";
import { saveListing, deleteListing, uploadWebsiteImage, saveTestimonial, savePartnership, deletePartnership, deleteTestimonial } from "@/lib/actions/website";
import { dateRangeText, listingFromProgram, staleness, imageUrl } from "@/lib/website";

/**
 * The Website page edits risingstars.training's own tables. What's saved is
 * live at once, so what must hold: nothing half-filled, one listing per
 * CoachOS program, and only pictures uploaded.
 */

const made: string[] = [];
afterEach(async () => {
  if (made.length) await adminPublic.from("programs").delete().in("id", made.splice(0));
  await adminPublic.from("testimonials").delete().like("name", "Test %");
  await adminPublic.from("partnerships").delete().like("type", "Test %");
  await truncateAll();
});

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

async function listing(fields: Record<string, string | string[]>) {
  const res: any = await saveListing(form({ title: "Lil Dribblers", description: "Soccer for K–1", ...fields }));
  if (res.id) made.push(res.id);
  return res;
}

describe("program listings", () => {
  it("saves what parents will see, and refuses one that isn't ready", async () => {
    const res = await listing({ type: "upcoming", start_date: "2026-09-08", end_date: "2026-12-11", age_groups: ["4-6 years", "7-9 years"], price: "$100/month" });
    expect(res.error).toBeUndefined();
    const { data } = await adminPublic.from("programs").select("title, type, age_groups, start_date, price").eq("id", res.id).single();
    expect(data).toEqual({ title: "Lil Dribblers", type: "upcoming", age_groups: ["4-6 years", "7-9 years"], start_date: "2026-09-08", price: "$100/month" });

    expect(((await saveListing(form({ title: "", description: "x" }))) as any).error).toMatch(/title/);
    expect(((await saveListing(form({ title: "x", description: "" }))) as any).error).toMatch(/description/);
    expect(((await saveListing(form({ title: "x", description: "y", start_date: "2026-12-11", end_date: "2026-09-08" }))) as any).error).toMatch(/before the start/);
  });

  it("links one listing per CoachOS program: linking a second unlinks the first", async () => {
    const { programId } = await seedProgram();
    const first = await listing({ ops_program_id: programId });
    const second = await listing({ title: "Lil Dribblers (new photo)", ops_program_id: programId });
    const { data } = await adminPublic.from("programs").select("id, ops_program_id").in("id", [first.id, second.id]);
    const byId = Object.fromEntries((data || []).map((r) => [r.id, r.ops_program_id]));
    expect(byId[first.id]).toBeNull();
    expect(byId[second.id]).toBe(programId);
  });

  it("edits in place and deletes", async () => {
    const res = await listing({});
    expect(((await saveListing(form({ id: res.id, title: "Renamed", description: "d" }))) as any).success).toBe(true);
    expect((await adminPublic.from("programs").select("title").eq("id", res.id).single()).data!.title).toBe("Renamed");
    expect(((await deleteListing(res.id)) as any).success).toBe(true);
    expect((await adminPublic.from("programs").select("id").eq("id", res.id)).data).toEqual([]);
  });

  it("fills a listing from a program, and spots ones that are out of date", () => {
    const f = listingFromProgram({
      id: "p1", name: "Lil Dribblers", school_name: "Lakehill", location: null, monthly_fee: 100, capacity: 12,
      start_date: "2026-09-08", end_date: "2026-12-11", status: "active", public_description: null, seats_remaining: 4,
    });
    expect(f).toMatchObject({ title: "Lil Dribblers", type: "current", location: "Lakehill", price: "$100/month", slots: "12 spots", ops_program_id: "p1", date_range: "September 8 – December 11, 2026" });
    expect(dateRangeText("2026-12-01", "2027-02-01")).toBe("December 1, 2026 – February 1, 2027");
    expect(staleness({ type: "current", start_date: null, end_date: "2025-12-01" }, "2026-10-02")).toMatch(/Ended/);
    expect(staleness({ type: "upcoming", start_date: "2026-09-01", end_date: null }, "2026-10-02")).toMatch(/Upcoming/);
    expect(staleness({ type: "current", start_date: "2026-09-01", end_date: "2026-12-01" }, "2026-10-02")).toBeNull();
    expect(imageUrl("/lovable-uploads/a.png")).toBe("https://risingstars.training/lovable-uploads/a.png");
  });
});

describe("pictures", () => {
  it("uploads a picture and refuses anything else", async () => {
    const png = new File([Buffer.from("89504e470d0a1a0a", "hex")], "kick.png", { type: "image/png" });
    const fd = new FormData();
    fd.set("file", png);
    const res: any = await uploadWebsiteImage(fd);
    expect(res.error).toBeUndefined();
    expect(res.url).toMatch(/\/storage\/v1\/object\/public\/ai-generated-images\/program\/program_\d+\.png$/);

    const bad = new FormData();
    bad.set("file", new File(["<script>"], "x.html", { type: "text/html" }));
    expect(((await uploadWebsiteImage(bad)) as any).error).toMatch(/isn't a picture/);
  });
});

describe("testimonials and partnerships", () => {
  it("keep stars between 1 and 5, and benefits one per line", async () => {
    await saveTestimonial(form({ name: "Test Parent", relationship: "Mom of Mia", quote: "Mia loves it!", stars: "9" }));
    const { data: t } = await adminPublic.from("testimonials").select("id, stars").eq("name", "Test Parent").single();
    expect(t!.stars).toBe(5);
    await savePartnership(form({ type: "Test Schools", description: "After-school programs", benefits: "Free trial\n\n No setup  \nCoaches provided" }));
    const { data: p } = await adminPublic.from("partnerships").select("id, benefits, icon").eq("type", "Test Schools").single();
    expect(p).toMatchObject({ benefits: ["Free trial", "No setup", "Coaches provided"], icon: "🤝" });
    expect(((await saveTestimonial(form({ name: "", quote: "" }))) as any).error).toBeTruthy();
    await deleteTestimonial(t!.id);
    await deletePartnership(p!.id);
  });
});
