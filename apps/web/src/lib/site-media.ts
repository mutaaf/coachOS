/**
 * The website's photo library (contract v1.2): which places on the site a
 * photo can go, and the rules a photo must meet before it is shown.
 *
 * Plain and shared by the page, the server actions and the tests. The
 * database enforces the same publish rule (ops.site_media's
 * site_media_publishable check and the public.site_media view).
 */

export const SITE_MEDIA_BUCKET = "site-media";
export const RENDITION_WIDTHS = [480, 960, 1600] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const ALT_HINT =
  "Say what's in the photo for someone who can't see it — who is doing what, and where. " +
  "For example: “Two girls racing to the ball during soccer practice in a school gym.” " +
  "Don't use children's names.";

export interface SlotInfo {
  slot: string;
  label: string;
  where: string;
  /** Several photos in order (a slideshow); otherwise the first one is used. */
  ordered?: boolean;
}

/** The fixed places on the site, in the order they appear on the home page. */
export const SLOTS: SlotInfo[] = [
  { slot: "hero", label: "Home page slideshow", where: "The big photos at the top of the home page, in this order.", ordered: true },
  { slot: "programs_section", label: "Programs section", where: "Behind the heading of the programs list." },
  { slot: "levels_section", label: "Levels section", where: "The section about age groups and skill levels." },
  { slot: "about", label: "About us", where: "The About section and page." },
  { slot: "partnerships_section", label: "Schools & partners", where: "The section for schools that want to host a program." },
  { slot: "contact_section", label: "Contact", where: "Next to the contact form." },
  { slot: "og_default", label: "Link preview", where: "The picture shown when someone shares the site on WhatsApp, Facebook or a text." },
];

export function slotInfo(slot: string): SlotInfo {
  const fixed = SLOTS.find((s) => s.slot === slot);
  if (fixed) return fixed;
  if (slot.startsWith("sport:")) {
    const sport = slot.slice(6);
    return { slot, label: `Any ${sport} program`, where: `Program cards for ${sport} that don't have their own photo.` };
  }
  if (slot === "offering") return { slot, label: "A program card", where: "One program's card on the site." };
  return { slot, label: slot, where: "" };
}

/** "Flag Football " → "sport:flag football"; null when it isn't a usable name. */
export function sportSlot(sport: string): string | null {
  const s = sport.trim().toLowerCase().replace(/\s+/g, " ");
  return /^[a-z0-9]+([ _-][a-z0-9]+)*$/.test(s) ? `sport:${s}` : null;
}

/** Whether `slot` is one the database accepts (offering needs an offering id too). */
export function validSlot(slot: string): boolean {
  return SLOTS.some((s) => s.slot === slot) || slot === "offering" || (slot.startsWith("sport:") && sportSlot(slot.slice(6)) === slot);
}

export interface PhotoSafety {
  status?: string;
  url?: string;
  alt: string | null;
  contains_identifiable_minors: boolean;
  photo_release_confirmed: boolean;
}

/** Why a photo can't be published yet, in her words. Empty when it can. */
export function publishProblems(m: PhotoSafety): string[] {
  const out: string[] = [];
  if (m.status && m.status !== "ready") out.push("It's still uploading.");
  if (!(m.alt ?? "").trim()) out.push("Add a description (alt text) first.");
  if (m.contains_identifiable_minors && !m.photo_release_confirmed)
    out.push("It shows children who can be recognized — confirm a photo release is on file for every one of them first.");
  return out;
}

export interface Rendition {
  w: number;
  url: string;
}

/** The smallest size at least `min` wide, for thumbnails; the original when there are no sizes. */
export function thumbUrl(m: { url: string; srcset?: Rendition[] | null }, min = 480): string {
  const sizes = [...(m.srcset ?? [])].sort((a, b) => a.w - b.w);
  return (sizes.find((r) => r.w >= min) ?? sizes[sizes.length - 1])?.url ?? m.url;
}

/** CSS object-position for a focal point (0–1 each way). */
export function focalPosition(x: number, y: number): string {
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5)) * 1000) / 10}%`;
  return `${pct(x)} ${pct(y)}`;
}

/** Where a click landed on an element, as a 0–1 focal point rounded to 3 places. */
export function focalFromClick(clickX: number, clickY: number, rect: { left: number; top: number; width: number; height: number }) {
  const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return { x: clamp((clickX - rect.left) / rect.width), y: clamp((clickY - rect.top) / rect.height) };
}

/**
 * Which WebP widths to make for an image `width` pixels wide: 480, 960 and
 * 1600 where the original is at least that wide (never upscaled), plus the
 * original's own width when it's under 1600 and no size is close to it — so a
 * 900-wide photo gets 480 and 900, not just a blurry 480.
 */
export function renditionWidths(width: number): number[] {
  const out: number[] = RENDITION_WIDTHS.filter((w) => w <= width);
  const last = out[out.length - 1] ?? 0;
  if (width < RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1] && last < width * 0.9) out.push(Math.max(1, Math.round(width)));
  return out;
}
