import { describe, it, expect, afterEach } from "vitest";
import { admin, anonOps, anonPublic, seedProgram, truncateAll } from "../helpers/db";
import { signedOut } from "../helpers/auth";
import { updateInquiryStatus } from "@/lib/actions/inquiries";
import { getInquiries } from "@/lib/queries/inquiries";
import { attributionSummary } from "@/lib/attribution";

/**
 * The website's forms write into CoachOS through public.submit_inquiry: a
 * family's question becomes an inquiry on the Marketing page, a school's
 * becomes a lead in the pipeline. Anon can write one and learn its id —
 * nothing else.
 */

afterEach(async () => {
  await admin.from("leads").delete().eq("source", "website");
  await truncateAll();
});

let n = 0;
const phone = () => `+1469555${String(++n).padStart(4, "0")}`;

function inquiry(kind: string, contact: Record<string, unknown>, details: Record<string, unknown> = {}, attribution: unknown = null) {
  return anonPublic.rpc("submit_inquiry", { p_kind: kind, p_contact: contact, p_details: details, p_attribution: attribution });
}

describe("submit_inquiry", () => {
  it("files a family's question, keeps only the agreed attribution, and returns just the id", async () => {
    const { programId } = await seedProgram();
    const { data: id, error } = await inquiry(
      "trial",
      { first_name: " Sara ", last_name: "Yusuf", phone: "(214) 555-0199", email: "Sara@Example.com" },
      { message: "Can Amina try a class?", child_ages: "6", offering_id: programId, inquiry_types: ["trial", ""], preferred_date: "2026-10-12" },
      {
        first_touch: { utm_source: "google", utm_medium: "cpc", utm_campaign: "fall", evil: "x" },
        last_touch: { referrer: "https://www.facebook.com/" },
        ga_client_id: "123.456",
        medical_notes: "should not be kept",
      }
    );
    expect(error).toBeNull();
    expect(typeof id).toBe("string");

    // Anon cannot read it back.
    const { data: leaked } = await anonOps.from("inquiries").select("*");
    expect(leaked).toBeNull();

    const { data: row } = await admin.from("inquiries").select("*").eq("id", id).single();
    expect(row).toMatchObject({
      kind: "trial",
      status: "new",
      first_name: "Sara",
      phone: "+12145550199",
      email: "sara@example.com",
      offering_id: programId,
      inquiry_types: ["trial"],
      preferred_date: "2026-10-12",
      attribution: {
        first_touch: { utm_source: "google", utm_medium: "cpc", utm_campaign: "fall" },
        last_touch: { referrer: "https://www.facebook.com/" },
        ga_client_id: "123.456",
      },
    });
    expect(attributionSummary(row.attribution)).toBe("facebook.com / referral");
  });

  it("sends a school or organisation to the leads pipeline", async () => {
    const { data: id, error } = await inquiry(
      "partnership",
      { first_name: "Pat", last_name: "Lee", email: "pat@lakehill.org" },
      { organization: "Lakehill Prep", message: "After-school program?" },
      { first_touch: { utm_source: "newsletter" } }
    );
    expect(error).toBeNull();
    const { data: lead } = await admin.from("leads").select("*").eq("id", id).single();
    expect(lead).toMatchObject({
      school_name: "Lakehill Prep",
      contact_name: "Pat Lee",
      contact_email: "pat@lakehill.org",
      stage: "identified",
      source: "website",
      notes: "After-school program?",
      attribution: { first_touch: { utm_source: "newsletter" } },
    });
    const { count } = await admin.from("inquiries").select("*", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("refuses an unknown kind and a message nobody could reply to", async () => {
    expect((await inquiry("spam", { phone: phone() })).error?.message).toMatch(/unknown inquiry kind/i);
    expect((await inquiry("general", { first_name: "No contact" })).error?.message).toMatch(/phone number or an email/i);
    expect((await inquiry("general", { email: "not-an-email" })).error?.message).toMatch(/email/i);
  });

  it("drops an offering that doesn't exist rather than failing", async () => {
    const { data: id, error } = await inquiry("program_question", { phone: phone() }, { offering_id: "00000000-0000-0000-0000-000000000000" });
    expect(error).toBeNull();
    const { data: row } = await admin.from("inquiries").select("offering_id").eq("id", id).single();
    expect(row!.offering_id).toBeNull();
  });

  it("throttles one person, by phone or email", async () => {
    const p = phone();
    for (let i = 0; i < 5; i++) expect((await inquiry("general", { phone: p })).error).toBeNull();
    const sixth = await inquiry("general", { phone: p.replace("+1", "") });
    expect(sixth.error?.message).toMatch(/too many/i);
  });

  it("throttles a flood from many numbers", async () => {
    for (let i = 0; i < 30; i++) expect((await inquiry("general", { phone: phone() })).error).toBeNull();
    expect((await inquiry("general", { phone: phone() })).error?.message).toMatch(/a lot of messages/i);
  });
});

describe("working an inquiry in CoachOS", () => {
  it("lists them with the program asked about, and moves their status", async () => {
    const { programId } = await seedProgram();
    const { data: id } = await inquiry("waitlist_interest", { phone: phone() }, { offering_id: programId });

    const [listed] = await getInquiries();
    expect(listed.id).toBe(id);
    expect(listed.offering?.name).toMatch(/^Test Program/);

    expect(await updateInquiryStatus(id, "trial_booked")).toEqual({ success: true });
    expect((await admin.from("inquiries").select("status").eq("id", id).single()).data!.status).toBe("trial_booked");
    expect(((await updateInquiryStatus(id, "maybe")) as any).error).toMatch(/isn't a status/);
    expect(((await signedOut(() => updateInquiryStatus(id, "lost"))) as any).error).toMatch(/sign in/i);
  });
});
