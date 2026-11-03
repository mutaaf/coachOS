/**
 * The website (risingstars.training) reads its program listings, testimonials
 * and partnerships from the `public` schema of this same database. CoachOS
 * edits them in place — what's saved here is on the site at once.
 *
 * A listing can be linked to a CoachOS program (`ops_program_id`). Then the
 * site shows live open places and registers families straight into CoachOS;
 * unlinked listings fall back to their typed "spots" text and an old form.
 *
 * A linked listing is a marketing overlay: its words, picture, ages, order and
 * SEO are edited here, but its price, places, dates and location belong to
 * the CoachOS session (OPS_OWNED). The Website page shows those read-only and
 * never writes them; the database keeps the listing's copies equal to the
 * session's (migration 20261005000500), and the website reads them from
 * public.site_offerings.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://risingstars.training").replace(/\/$/, "");

/** Where uploaded images go: the bucket the old admin already used. */
export const IMAGE_BUCKET = "ai-generated-images";

export interface Listing {
  id: string;
  title: string;
  description: string;
  type: "current" | "upcoming";
  date_range: string;
  start_date: string | null;
  end_date: string | null;
  location: string;
  image: string;
  price: string;
  slots: string;
  age_groups: string[];
  registration_date: string | null;
  ops_program_id: string | null;
  /** Overlay settings (public.site_offerings). */
  published: boolean;
  featured: boolean;
  sort_order: number;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

/** A linked listing's fields that come from its CoachOS session, never from this form. */
export const OPS_OWNED = ["price", "slots", "date_range", "start_date", "end_date", "location"] as const;

/** "$120/month", as the site shows a monthly fee. */
export function priceText(monthlyFee: number): string {
  return `$${Number(monthlyFee).toLocaleString("en-US", { maximumFractionDigits: 2 })}/month`;
}

/** A slug is lower-case words joined by hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const AGE_GROUPS = ["4-6 years", "7-9 years", "10-12 years", "13+ years"];

/** An image path as the site stores it, made absolute for a preview here. */
export function imageUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  if (/^https?:\/\//.test(image)) return image;
  return `${SITE_URL}${image.startsWith("/") ? "" : "/"}${image}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September 8 – December 11, 2026" from two dates, as the site shows them. */
export function dateRangeText(start: string | null, end: string | null): string {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return { y, m, day };
  };
  if (!start && !end) return "";
  if (start && !end) {
    const s = parse(start);
    return `Starts ${MONTHS[s.m - 1]} ${s.day}, ${s.y}`;
  }
  if (!start && end) {
    const e = parse(end);
    return `Until ${MONTHS[e.m - 1]} ${e.day}, ${e.y}`;
  }
  const s = parse(start!);
  const e = parse(end!);
  if (s.y === e.y) return `${MONTHS[s.m - 1]} ${s.day} – ${MONTHS[e.m - 1]} ${e.day}, ${e.y}`;
  return `${MONTHS[s.m - 1]} ${s.day}, ${s.y} – ${MONTHS[e.m - 1]} ${e.day}, ${e.y}`;
}

export interface ProgramForListing {
  id: string;
  name: string;
  school_name: string | null;
  location: string | null;
  monthly_fee: number;
  capacity: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
  public_description: string | null;
  seats_remaining: number | null;
}

/** A listing's fields as they'd be filled from a CoachOS program. */
export function listingFromProgram(
  p: ProgramForListing
): Omit<Listing, "id" | "image" | "age_groups" | "registration_date" | "published" | "featured" | "sort_order" | "slug" | "seo_title" | "seo_description"> {
  return {
    title: p.name,
    description: p.public_description ?? "",
    type: p.status === "upcoming" ? "upcoming" : "current",
    start_date: p.start_date,
    end_date: p.end_date,
    date_range: dateRangeText(p.start_date, p.end_date),
    location: p.location || p.school_name || "",
    price: priceText(p.monthly_fee),
    slots: `${p.capacity} spots`,
    ops_program_id: p.id,
  };
}

/** Why a listing probably shouldn't be on the site as it is, if it shouldn't. */
export function staleness(l: Pick<Listing, "type" | "start_date" | "end_date">, today: string): string | null {
  if (l.end_date && l.end_date < today) return "Ended — still on the site";
  if (l.type === "upcoming" && l.start_date && l.start_date <= today) return "Has started — still says Upcoming";
  return null;
}
