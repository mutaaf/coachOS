import { describe, it, expect, afterEach } from "vitest";
import { admin, anonOps, anonPublic, seedProgram, truncateAll, sql } from "../helpers/db";
import { convertRegistration } from "@/lib/actions/registrations";
import { recordSmsChoice, setPhotoRelease } from "@/lib/actions/consents";
import { getFamily } from "@/lib/queries/families";

/**
 * Consent (contract v1.1): what a parent agreed to on the website is stored
 * exactly as sent, follows the family onto the roster, and later decisions
 * (a STOP, a withdrawn photo release) win over earlier ones.
 */

afterEach(truncateAll);

let n = 0;
const phone = () => `+1972555${String(++n).padStart(4, "0")}`;

async function registerV2(programId: string, consents: Record<string, unknown>, p = phone(), children = [{ first_name: "Zara", last_name: "Khan" }]) {
  const { data, error } = await anonPublic.rpc("submit_registration_v2", {
    p_offering_id: programId,
    p_parent: { first_name: "Hina", last_name: "Khan", phone: p, email: `hina${n}@example.com` },
    p_children: children,
    p_consents: consents,
    p_attribution: null,
    p_idempotency_key: null,
  });
  if (error) throw error;
  return { phone: p, ids: (data.outcomes as { registration_id: string }[]).map((o) => o.registration_id) };
}

const V11 = {
  terms: true,
  medical: true,
  photo: false,
  sms: true,
  marketing_email: true,
  policy_version: "2026-10",
  documents: { privacy: "2026-10-01", terms: "2026-10-01", registration_terms: "2026-09", child_safety: "1.0" },
  future_checkbox: { anything: [1, 2] },
  accepted_at: "1999-01-01T00:00:00Z",
};

describe("submit_registration_v2 consents", () => {
  it("keeps every key exactly as sent, unknown ones included, with the server's own timestamp", async () => {
    const { programId } = await seedProgram();
    const before = Date.now();
    const { ids } = await registerV2(programId, V11);
    const { data: reg } = await admin.from("registrations").select("consents").eq("id", ids[0]).single();
    const { accepted_at, client_accepted_at, ...rest } = reg!.consents;
    const { accepted_at: _sent, ...sent } = V11;
    expect(rest).toEqual(sent);
    expect(client_accepted_at).toBe("1999-01-01T00:00:00Z");
    expect(new Date(accepted_at).getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  it("still requires terms, and refuses an oversized object", async () => {
    const { programId } = await seedProgram();
    await expect(registerV2(programId, { ...V11, terms: false })).rejects.toThrow(/accept the terms/);
    await expect(registerV2(programId, { terms: true, junk: "x".repeat(20000) })).rejects.toThrow(/too long/);
  });
});

describe("consent follows the family onto the roster", () => {
  it("copies texts and newsletter opt-ins to the parent and the photo answer to the child, with history", async () => {
    const { programId } = await seedProgram();
    const { ids } = await registerV2(programId, V11);
    expect(await convertRegistration(ids[0])).toEqual({ success: true });

    const { data: reg } = await admin.from("registrations").select("parent_id, student_id").eq("id", ids[0]).single();
    const { data: parent } = await admin.from("parents").select("*").eq("id", reg!.parent_id).single();
    expect(parent!.sms_consent_at).toBeTruthy();
    expect(parent!.sms_opt_out_at).toBeNull();
    expect(parent!.marketing_email_consent_at).toBeTruthy();
    const { data: child } = await admin.from("students").select("photo_release").eq("id", reg!.student_id).single();
    expect(child!.photo_release).toBe(false);

    const { data: log } = await admin.from("consent_log").select("kind, granted, source, policy_version").eq("registration_id", ids[0]);
    expect(log!.map((l) => l.kind).sort()).toEqual(["marketing_email", "photo", "sms"]);
    expect(log!.every((l) => l.source === "website_registration" && l.policy_version === "2026-10")).toBe(true);

    // The family page shows it all, and flags the child for photos.
    const family = await getFamily(reg!.parent_id);
    expect(family!.children[0].photo_release).toBe(false);
    expect(family!.children[0].consents).toMatchObject({ terms: true, sms: true, documents: { child_safety: "1.0" } });
  });

  it("a later STOP wins, an older consent can't undo it, and opting back in clears it", async () => {
    const { programId } = await seedProgram();
    const { ids } = await registerV2(programId, V11);
    await convertRegistration(ids[0]);
    const { data: reg } = await admin.from("registrations").select("parent_id, student_id").eq("id", ids[0]).single();

    expect(await recordSmsChoice(reg!.parent_id, false)).toEqual({ success: true });
    let { data: p } = await admin.from("parents").select("sms_opt_out_at").eq("id", reg!.parent_id).single();
    expect(p!.sms_opt_out_at).toBeTruthy();

    // Replaying the (older) website consent changes nothing.
    await admin.rpc("record_consent", {
      p_kind: "sms", p_granted: true, p_source: "website_registration",
      p_parent_id: reg!.parent_id, p_at: "2020-01-01T00:00:00Z",
    });
    ({ data: p } = await admin.from("parents").select("sms_opt_out_at").eq("id", reg!.parent_id).single());
    expect(p!.sms_opt_out_at).toBeTruthy();

    await recordSmsChoice(reg!.parent_id, true);
    ({ data: p } = await admin.from("parents").select("sms_opt_out_at, sms_consent_at").eq("id", reg!.parent_id).single());
    expect(p!.sms_opt_out_at).toBeNull();
    expect(p!.sms_consent_at).toBeTruthy();

    expect(await setPhotoRelease(reg!.student_id, true, reg!.parent_id)).toEqual({ success: true });
    const { data: c } = await admin.from("students").select("photo_release").eq("id", reg!.student_id).single();
    expect(c!.photo_release).toBe(true);
  });

  it("is closed to the public: no reading the history, no recording consent", async () => {
    expect((await anonOps.from("consent_log").select("*")).data).toBeNull();
    const [row] = sql<{ anon: boolean; authenticated: boolean }>(`
      SELECT has_function_privilege('anon', 'ops.record_consent(text, boolean, text, uuid, uuid, uuid, timestamptz, text, jsonb, uuid)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'ops.record_consent(text, boolean, text, uuid, uuid, uuid, timestamptz, text, jsonb, uuid)', 'EXECUTE') AS authenticated`);
    expect(row).toEqual({ anon: false, authenticated: false });
  });
});

describe("contact-form consents (submit_inquiry p_details.consents)", () => {
  it("stores p_details verbatim and its consents with a server timestamp; a texts opt-in needs a phone", async () => {
    const { data: id, error } = await anonPublic.rpc("submit_inquiry", {
      p_kind: "general",
      p_contact: { first_name: "Ola", email: "ola@example.com" },
      p_details: { message: "Hi", new_field: [1], consents: { sms: true, marketing_email: true, policy_version: "2026-10", documents: { privacy: "1" } } },
      p_attribution: null,
    });
    expect(error).toBeNull();
    const { data: row } = await admin.from("inquiries").select("details, consents").eq("id", id).single();
    expect(row!.details).toMatchObject({ message: "Hi", new_field: [1] });
    expect(row!.consents).toMatchObject({ marketing_email: true, policy_version: "2026-10", documents: { privacy: "1" } });
    expect(row!.consents.sms).toBeUndefined(); // no phone given
    expect(row!.consents.accepted_at).toBeTruthy();
  });

  it("an opt-in on the contact form counts for the family already on file", async () => {
    const p = phone();
    const { data: parent } = await admin.from("parents").insert({ first_name: "A", last_name: "B", phone: p, email: "ab@example.com" }).select("id").single();
    await anonPublic.rpc("submit_inquiry", {
      p_kind: "general",
      p_contact: { phone: p, email: "ab@example.com" },
      p_details: { consents: { sms: true, marketing_email: true } },
      p_attribution: null,
    });
    const { data: after } = await admin.from("parents").select("sms_consent_at, marketing_email_consent_at").eq("id", parent!.id).single();
    expect(after!.sms_consent_at).toBeTruthy();
    expect(after!.marketing_email_consent_at).toBeTruthy();
  });
});
