import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { admin, adminPublic, anonOps, anonPublic, ensureOutsider, LOCAL, OUTSIDER, seedProgram, truncateAll } from "../helpers/db";
import { signedOut } from "../helpers/auth";
import { NOT_SIGNED_IN } from "@/lib/auth-guard";
import {
  deletePhoto,
  finishPhotoUpload,
  placePhoto,
  removePlacement,
  reorderSlot,
  setPhotoPublished,
  startPhotoUpload,
  updatePhoto,
} from "@/lib/actions/site-media";
import { focalFromClick, focalPosition, publishProblems, renditionWidths, sportSlot, thumbUrl, validSlot } from "@/lib/site-media";

/**
 * The website's photos, managed in CoachOS (contract v1.2): uploaded once,
 * cleaned and resized on the server, described, placed, and published — and a
 * photo of children the owner can recognize never reaches the site without a
 * photo release on file.
 */

const BUCKET = "site-media";
const made: string[] = [];

afterEach(async () => {
  for (const id of made.splice(0)) await deletePhoto(id);
  await admin.from("site_media").delete().like("original_filename", "zz-%");
  await adminPublic.from("programs").delete().like("title", "Zz Media%");
  await truncateAll();
  await admin.from("program_catalog").delete().like("name", "Zz Media%");
});

/** A JPEG `w`×`h` with EXIF that says "rotate 90°" and a GPS position, like a phone photo. */
async function phonePhoto(w = 2000, h = 1200) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "33/1 0/1 0/1" } } })
    .toBuffer();
}

/** Upload the way the page does: ask, send straight to storage, finish. */
async function upload(data: Buffer, name = "zz-photo.jpg", type = "image/jpeg", replaceId?: string, answers?: Record<string, boolean>) {
  const start = await startPhotoUpload({ name, type, size: data.length }, replaceId);
  if (!("success" in start)) throw new Error(JSON.stringify(start));
  const { error } = await anonPublic.storage.from(BUCKET).uploadToSignedUrl(start.path, start.token, data, { contentType: type });
  if (error) throw error;
  const done = await finishPhotoUpload(start.id, start.path, answers as any);
  if (!("success" in done)) throw new Error(JSON.stringify(done));
  if (!made.includes(start.id)) made.push(start.id);
  return start.id;
}

async function row(id: string) {
  const { data } = await admin.from("site_media").select("*").eq("id", id).single();
  return data as Record<string, any>;
}

/** The URL of the widest size made. */
const largest = (m: Record<string, any>) => [...m.srcset].sort((a: any, b: any) => b.w - a.w)[0].url as string;

async function fetchOk(url: string) {
  const res = await fetch(url);
  return { ok: res.ok, type: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()) };
}

describe("rules, without a database", () => {
  it("won't publish without a description, or a recognizable child without a release", () => {
    const ok = { status: "ready", alt: "Kids at practice", contains_identifiable_minors: false, photo_release_confirmed: false };
    expect(publishProblems(ok)).toEqual([]);
    expect(publishProblems({ ...ok, alt: "  " })).toEqual(["Add a description (alt text) first."]);
    expect(publishProblems({ ...ok, contains_identifiable_minors: true })[0]).toMatch(/photo release/);
    expect(publishProblems({ ...ok, contains_identifiable_minors: true, photo_release_confirmed: true })).toEqual([]);
  });

  it("knows the site's places, and sports by name", () => {
    expect(validSlot("hero")).toBe(true);
    expect(validSlot("sport:flag football")).toBe(true);
    expect(validSlot("sport:Flag Football")).toBe(false);
    expect(validSlot("footer")).toBe(false);
    expect(sportSlot(" Flag  Football ")).toBe("sport:flag football");
    expect(sportSlot("!!")).toBeNull();
  });

  it("never makes a size wider than the original", () => {
    expect(renditionWidths(4000)).toEqual([480, 960, 1600]);
    expect(renditionWidths(1600)).toEqual([480, 960, 1600]);
    expect(renditionWidths(1000)).toEqual([480, 960]);
    expect(renditionWidths(900)).toEqual([480, 900]);
    expect(renditionWidths(1200)).toEqual([480, 960, 1200]);
    expect(renditionWidths(300)).toEqual([300]);
  });

  it("turns a tap into a focal point and back", () => {
    expect(focalFromClick(150, 50, { left: 100, top: 0, width: 200, height: 100 })).toEqual({ x: 0.25, y: 0.5 });
    expect(focalFromClick(-5, 500, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 1 });
    expect(focalPosition(0.25, 0.333)).toBe("25% 33.3%");
    expect(thumbUrl({ url: "o", srcset: [{ w: 1600, url: "l" }, { w: 480, url: "s" }] })).toBe("s");
    expect(thumbUrl({ url: "o", srcset: [] })).toBe("o");
  });
});

describe("uploading", () => {
  it("cleans the photo, makes WebP sizes, and records its size", async () => {
    const id = await upload(await phonePhoto());
    const m = await row(id);
    expect(m.status).toBe("ready");
    // Turned upright from the EXIF orientation: 2000×1200 rotated is 1200×2000.
    expect([m.width, m.height]).toEqual([1200, 2000]);
    expect(m.srcset.map((r: any) => r.w)).toEqual([480, 960, 1200]);
    expect(m.published).toBe(false);

    const original = await fetchOk(m.url);
    expect(original.ok).toBe(true);
    const meta = await sharp(original.body).metadata();
    // No location or other EXIF on the public file.
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
    for (const r of m.srcset) {
      const f = await fetchOk(r.url);
      expect(f.type).toBe("image/webp");
      expect((await sharp(f.body).metadata()).width).toBe(r.w);
    }
    // The staged upload is gone.
    const { data: staged } = await admin.storage.from(BUCKET).list(`incoming/${id}`);
    expect(staged ?? []).toEqual([]);
  });

  it("makes all three sizes for a big photo", async () => {
    const id = await upload(await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#336699" } }).png().toBuffer(), "zz-big.png", "image/png");
    expect((await row(id)).srcset.map((r: any) => r.w)).toEqual([480, 960, 1600]);
  });

  it("refuses what isn't a photo, or is too big, before anything is stored", async () => {
    expect(await startPhotoUpload({ name: "x.pdf", type: "application/pdf", size: 100 })).toHaveProperty("error");
    expect(await startPhotoUpload({ name: "x.jpg", type: "image/jpeg", size: 16 * 1024 * 1024 })).toEqual({ error: "“x.jpg” is over 15 MB. Choose a smaller copy." });
    expect(await signedOut(() => startPhotoUpload({ name: "x.jpg", type: "image/jpeg", size: 10 }))).toEqual(NOT_SIGNED_IN);
  });

  it("finishes only an upload that belongs to the photo", async () => {
    const start = (await startPhotoUpload({ name: "zz-a.jpg", type: "image/jpeg", size: 10 })) as any;
    made.push(start.id);
    expect(await finishPhotoUpload(start.id, `incoming/someone-else/x.jpg`)).toEqual({ error: "That upload doesn't belong to this photo." });
    expect(await finishPhotoUpload(start.id, start.path)).toEqual({ error: "The upload didn't arrive. Try again." });
  });

  it("rejects a file that isn't really an image, and keeps nothing of it", async () => {
    const data = Buffer.from("not an image at all");
    const start = (await startPhotoUpload({ name: "zz-fake.jpg", type: "image/jpeg", size: data.length })) as any;
    made.push(start.id);
    await anonPublic.storage.from(BUCKET).uploadToSignedUrl(start.path, start.token, data, { contentType: "image/jpeg" });
    expect(await finishPhotoUpload(start.id, start.path)).toEqual({ error: "That file couldn't be read as a photo. Try exporting it again as a JPG." });
    const { data: staged } = await admin.storage.from(BUCKET).list(`incoming/${start.id}`);
    expect(staged ?? []).toEqual([]);
  });

  it("replaces a photo's file where it's used, and removes the old files", async () => {
    const id = await upload(await phonePhoto(1000, 800));
    await updatePhoto(id, { alt: "Coach high-fiving a player", published: true });
    const before = await row(id);
    await upload(await phonePhoto(1700, 900), "zz-new.jpg", "image/jpeg", id);
    const after = await row(id);
    expect(after.url).not.toBe(before.url);
    expect(after.published).toBe(true);
    expect((await fetchOk(before.url)).ok).toBe(false);
    expect((await fetchOk(after.url)).ok).toBe(true);
  });

  it("takes a replaced photo down when its new answers say a release is missing", async () => {
    const id = await upload(await phonePhoto(800, 600));
    await updatePhoto(id, { alt: "An empty court", published: true });
    const res = await upload(await phonePhoto(800, 600), "zz-kids.jpg", "image/jpeg", id, { contains_identifiable_minors: true, photo_release_confirmed: false });
    expect(res).toBe(id);
    expect((await row(id)).published).toBe(false);
  });
});

describe("publishing and the public view", () => {
  async function publicRows() {
    const { data, error } = await anonPublic.from("site_media").select("*");
    expect(error).toBeNull();
    return (data ?? []) as Record<string, any>[];
  }

  it("shows only published, described photos — and children only with a release", async () => {
    const id = await upload(await phonePhoto(600, 400));
    await placePhoto(id, "about");
    expect(await publicRows()).toEqual([]);

    expect(await setPhotoPublished(id, true)).toEqual({ error: "Add a description (alt text) first." });
    expect(await updatePhoto(id, { alt: "Players stretching before practice", contains_identifiable_minors: true, published: true })).toEqual({
      error: "It shows children who can be recognized — confirm a photo release is on file for every one of them first.",
    });
    // The database says no too, whoever asks.
    const { error } = await admin.from("site_media").update({ alt: "x", contains_identifiable_minors: true, published: true }).eq("id", id);
    expect(error?.message).toMatch(/site_media_publishable/);

    expect(await updatePhoto(id, { alt: "Players stretching before practice", contains_identifiable_minors: true, photo_release_confirmed: true, published: true, focal_x: 0.2, focal_y: 0.8, caption: " Warm-ups " })).toEqual({ success: true });
    const rows = await publicRows();
    expect(rows).toHaveLength(1);
    const m = await row(id);
    expect(rows[0]).toEqual({
      id: rows[0].id,
      slot: "about",
      offering_id: null,
      sort_order: 0,
      alt: "Players stretching before practice",
      caption: "Warm-ups",
      focal_x: 0.2,
      focal_y: 0.8,
      // Upright: the phone photo was 600×400 lying on its side.
      width: 400,
      height: 600,
      url: m.url,
      srcset: m.srcset,
      updated_at: rows[0].updated_at,
    });

    // Unticking "children" clears the release; ticking it again needs it again.
    expect(await updatePhoto(id, { contains_identifiable_minors: false })).toEqual({ success: true });
    expect((await row(id)).photo_release_confirmed).toBe(false);
    expect(await updatePhoto(id, { contains_identifiable_minors: true })).toHaveProperty("error");

    // A row edited by hand to slip past the check still doesn't show.
    await setPhotoPublished(id, false);
    expect(await publicRows()).toEqual([]);
  });

  it("orders the slideshow, keeps one photo per other place, and puts a photo on a program card", async () => {
    const [a, b, c] = [await upload(await phonePhoto(500, 300)), await upload(await phonePhoto(500, 300)), await upload(await phonePhoto(500, 300))];
    for (const id of [a, b, c]) await updatePhoto(id, { alt: "A photo", published: true });
    for (const id of [a, b, c]) expect(await placePhoto(id, "hero")).toEqual({ success: true });
    // Placing it again doesn't add it twice.
    await placePhoto(a, "hero");
    const hero = async () =>
      ((await anonPublic.from("site_media").select("id, sort_order, url").eq("slot", "hero").order("sort_order")).data ?? []) as any[];
    const first = await hero();
    expect(first).toHaveLength(3);
    const { data: placements } = await admin.from("site_media_placements").select("id, media_id").eq("slot", "hero");
    const byMedia = new Map(placements!.map((p) => [p.media_id, p.id]));
    expect(await reorderSlot("hero", [byMedia.get(c)!, byMedia.get(a)!, byMedia.get(b)!])).toEqual({ success: true });
    expect((await hero()).map((h) => h.id)).toEqual([byMedia.get(c), byMedia.get(a), byMedia.get(b)]);

    await placePhoto(a, "og_default");
    await placePhoto(b, "og_default");
    const { data: og } = await anonPublic.from("site_media").select("url").eq("slot", "og_default");
    expect(og).toEqual([{ url: (await row(b)).url }]);

    const { programId } = await seedProgram();
    expect(await placePhoto(a, "offering")).toEqual({ error: "Pick which program card." });
    expect(await placePhoto(a, "offering", programId)).toEqual({ success: true });
    expect(await placePhoto(c, "sport:Soccer")).toEqual({ success: true });
    const { data: card } = await anonPublic.from("site_media").select("offering_id").eq("slot", "offering");
    expect(card).toEqual([{ offering_id: programId }]);
    expect((await anonPublic.from("site_media").select("slot").like("slot", "sport:%")).data).toEqual([{ slot: "sport:soccer" }]);

    expect(await removePlacement(byMedia.get(c)!)).toEqual({ success: true });
    expect(await hero()).toHaveLength(2);
    expect(await placePhoto(a, "footer")).toEqual({ error: "Pick where the photo should go." });
  });

  it("deletes a photo's files and its places", async () => {
    const id = await upload(await phonePhoto(500, 300));
    await updatePhoto(id, { alt: "A photo", published: true });
    await placePhoto(id, "contact_section");
    const m = await row(id);
    expect(await deletePhoto(id)).toEqual({ success: true });
    expect((await fetchOk(m.url)).ok).toBe(false);
    expect((await anonPublic.from("site_media").select("id")).data).toEqual([]);
    expect((await admin.from("site_media_placements").select("id").eq("media_id", id)).data).toEqual([]);
  });

  it("refuses every change from someone signed out", async () => {
    const id = await upload(await phonePhoto(500, 300));
    for (const call of [
      () => updatePhoto(id, { alt: "x" }),
      () => setPhotoPublished(id, true),
      () => placePhoto(id, "hero"),
      () => reorderSlot("hero", []),
      () => removePlacement(id),
      () => deletePhoto(id),
      () => finishPhotoUpload(id, `incoming/${id}/x.jpg`),
    ]) {
      expect(await signedOut(call)).toEqual(NOT_SIGNED_IN);
    }
    expect((await row(id)).alt).toBe("");
  });
});

describe("who can touch the bucket and the tables", () => {
  let outsider: ReturnType<typeof createClient>;
  beforeAll(async () => {
    await ensureOutsider();
    outsider = createClient(LOCAL.url, LOCAL.anonKey, { auth: { persistSession: false } });
    const { error } = await outsider.auth.signInWithPassword(OUTSIDER);
    if (error) throw error;
  });

  it("is public to read by URL, and nobody but CoachOS's server writes, lists or deletes", async () => {
    const id = await upload(await phonePhoto(400, 300));
    const m = await row(id);
    expect((await fetchOk(m.url)).ok).toBe(true);

    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    for (const client of [anonPublic, outsider]) {
      const { error: up } = await client.storage.from(BUCKET).upload(`hack-${Date.now()}.png`, png, { contentType: "image/png" });
      expect(up).not.toBeNull();
      const { error: over } = await client.storage.from(BUCKET).upload(m.original_path, png, { contentType: "image/png", upsert: true });
      expect(over).not.toBeNull();
      await client.storage.from(BUCKET).remove([m.original_path]);
      const { data: listed } = await client.storage.from(BUCKET).list(id);
      expect(listed ?? []).toEqual([]);
    }
    // Still there, unchanged.
    expect((await fetchOk(m.url)).ok).toBe(true);
    // The bucket's own limits.
    const { data: bucket } = await admin.storage.getBucket(BUCKET);
    expect(bucket).toMatchObject({ public: true, file_size_limit: 15 * 1024 * 1024 });
    expect(bucket!.allowed_mime_types).toEqual(expect.arrayContaining(["image/jpeg", "image/png", "image/webp"]));
  });

  it("keeps the library's tables private: release answers and uploaders never reach anon or a non-admin", async () => {
    const id = await upload(await phonePhoto(400, 300));
    expect((await anonOps.from("site_media").select("id")).error).not.toBeNull();
    expect((await anonOps.from("site_media_placements").select("id")).error).not.toBeNull();
    const asOutsider = createClient(LOCAL.url, LOCAL.anonKey, { db: { schema: "ops" }, auth: { persistSession: false } });
    await asOutsider.auth.signInWithPassword(OUTSIDER);
    const { data } = await asOutsider.from("site_media").select("id").eq("id", id);
    expect(data ?? []).toEqual([]);
    const { error } = await asOutsider.from("site_media").update({ published: true }).eq("id", id);
    expect((await row(id)).published).toBe(false);
    void error;
  });
});

describe("site_offerings.image_url follows the library", () => {
  it("prefers the card's photo, then the listing's, then the program's, then the sport's", async () => {
    const { programId } = await seedProgram();
    const { data: cat } = await admin.from("program_catalog").insert({ name: `Zz Media ${Date.now()}`, sport: "Soccer" }).select("id").single();
    await admin.from("programs").update({ catalog_id: cat!.id }).eq("id", programId);
    const image = async () =>
      ((await anonPublic.from("site_offerings").select("image_url").eq("offering_id", programId).single()).data as any).image_url;

    expect(await image()).toBeNull();

    const sport = await upload(await phonePhoto(2000, 1000));
    await updatePhoto(sport, { alt: "Soccer practice", published: true });
    // sport stored lower-case on the catalog? The slot matches either way.
    await placePhoto(sport, "sport:soccer");
    expect(await image()).toBe(largest(await row(sport)));

    await admin.from("program_catalog").update({ image: "/catalog.png" }).eq("id", cat!.id);
    expect(await image()).toBe("/catalog.png");

    await adminPublic.from("programs").insert({
      title: "Zz Media listing", description: "x", date_range: "", location: "", image: "/listing-cartoon.png",
      slots: "", price: "", age_groups: [], type: "current", ops_program_id: programId,
    });
    expect(await image()).toBe("/listing-cartoon.png");

    const card = await upload(await phonePhoto(900, 600));
    await updatePhoto(card, { alt: "Our coach with the team", published: true });
    await placePhoto(card, "offering", programId);
    // The largest size made — upright this one is 600 wide, so its own-width WebP.
    expect((await row(card)).srcset.map((r: any) => r.w)).toEqual([480, 600]);
    expect(await image()).toBe(largest(await row(card)));

    // Unpublished, the card's photo steps aside again.
    await setPhotoPublished(card, false);
    expect(await image()).toBe("/listing-cartoon.png");
  });
});
