import { createAdminPublicSupabase, createAdminSupabase } from "@/lib/supabase/server";
import type { Listing, ProgramForListing } from "@/lib/website";

export interface Testimonial {
  id: string;
  name: string;
  relationship: string;
  quote: string;
  stars: number;
  avatar: string | null;
}

export interface Partnership {
  id: string;
  type: string;
  icon: string;
  description: string;
  benefits: string[];
}

/** Everything the Website page shows: the site's content, and CoachOS's programs to link to. */
export async function getWebsite() {
  const site = createAdminPublicSupabase();
  const ops = createAdminSupabase();
  const [listings, testimonials, partnerships, programs, availability] = await Promise.all([
    site.from("programs").select("*").order("type").order("start_date", { ascending: false, nullsFirst: false }),
    site.from("testimonials").select("id, name, relationship, quote, stars, avatar").order("created_at"),
    site.from("partnerships").select("id, type, icon, description, benefits").order("created_at"),
    ops
      .from("programs")
      .select("id, name, location, monthly_fee, capacity, start_date, end_date, status, public_description, schools(name)")
      .in("status", ["active", "upcoming"])
      .order("name"),
    ops.from("program_availability").select("program_id, seats_remaining"),
  ]);
  const seats = new Map((availability.data || []).map((a: any) => [a.program_id, a.seats_remaining as number]));
  return {
    listings: (listings.data || []) as Listing[],
    testimonials: (testimonials.data || []) as Testimonial[],
    partnerships: (partnerships.data || []) as Partnership[],
    programs: ((programs.data || []) as any[]).map(
      (p): ProgramForListing => ({
        id: p.id,
        name: p.name,
        school_name: p.schools?.name ?? null,
        location: p.location,
        monthly_fee: Number(p.monthly_fee),
        capacity: p.capacity,
        start_date: p.start_date,
        end_date: p.end_date,
        status: p.status,
        public_description: p.public_description,
        seats_remaining: seats.get(p.id) ?? null,
      })
    ),
  };
}
