import { describe, it, expect, afterEach } from "vitest";
import { admin, anonPublic, seedProgram, truncateAll } from "../helpers/db";
import { convertRegistration } from "@/lib/actions/registrations";
import { recordSmsChoice, recordSmsPromotionalChoice } from "@/lib/actions/consents";

/**
 * Contract v1.3: `sms_promotional` is its own consent. Rising Stars isn't
 * registered as a Texas telephone solicitor (Bus. & Com. Code ch. 302), so a
 * promotional text goes only to a parent whose latest promotional answer is
 * yes. Program-text consent (`sms`) is never enough, and nobody who only
 * agreed to program texts became eligible (no backfill).
 */

afterEach(truncateAll);

let n = 0;
const phone = () => `+1214555${String(++n).padStart(4, "0")}`;

async function parent(extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("parents")
    .insert({ first_name: "Pro", last_name: `Mo${++n}`, phone: phone(), ...extra })
    .select("*")
    .single();
  if (error) throw error;
  return data!;
}

async function queue(phoneNumber: string, purpose: "operational" | "promotional") {
  const { data, error } = await admin
    .from("message_queue")
    .insert({ recipient_phone: phoneNumber, recipient_name: "Pro", message: "Hi", status: "pending", purpose })
    .select("id, status, error")
    .single();
  if (error) throw error;
  return data!;
}

async function registerV2(programId: string, consents: Record<string, unknown>, p = phone()) {
  const { data, error } = await anonPublic.rpc("submit_registration_v2", {
    p_offering_id: programId,
    p_parent: { first_name: "Ana", last_name: "Lopez", phone: p },
    p_children: [{ first_name: "Leo", last_name: "Lopez" }],
    p_consents: consents,
    p_attribution: null,
    p_idempotency_key: null,
  });
  if (error) throw error;
  return { phone: p, id: (data.outcomes as { registration_id: string }[])[0].registration_id };
}

describe("the promotional gate", () => {
  it("program-text consent alone is not enough — no backfill for existing parents", async () => {
    const p = await parent({ sms_consent_at: new Date().toISOString() });
    expect((await queue(p.phone, "operational")).status).toBe("pending");
    const promo = await queue(p.phone, "promotional");
    expect(promo.status).toBe("skipped");
    expect(promo.error).toMatch(/hasn't agreed to promotional texts/);
  });

  it("a recorded promotional consent lets promotions through; withdrawing it clears what was waiting", async () => {
    const p = await parent({ sms_consent_at: new Date().toISOString() });
    expect(await recordSmsPromotionalChoice(p.id, true)).toEqual({ success: true });
    const waiting = await queue(p.phone, "promotional");
    expect(waiting.status).toBe("pending");
    const op = await queue(p.phone, "operational");

    expect(await recordSmsPromotionalChoice(p.id, false)).toEqual({ success: true });
    const { data: rows } = await admin.from("message_queue").select("id, status").in("id", [waiting.id, op.id]);
    expect(rows!.find((r) => r.id === waiting.id)!.status).toBe("skipped");
    // Program texts carry on.
    expect(rows!.find((r) => r.id === op.id)!.status).toBe("pending");
    expect((await queue(p.phone, "promotional")).status).toBe("skipped");

    const { data: log } = await admin.from("consent_log").select("kind, granted, source").eq("parent_id", p.id).order("recorded_at");
    expect(log).toEqual([
      { kind: "sms_promotional", granted: true, source: "staff" },
      { kind: "sms_promotional", granted: false, source: "staff" },
    ]);
  });

  it("They said STOP clears both — and opting back in to program texts doesn't bring promotions back", async () => {
    const now = new Date().toISOString();
    const p = await parent({ sms_consent_at: now, sms_promotional_consent_at: now });
    expect((await queue(p.phone, "promotional")).status).toBe("pending");

    await recordSmsChoice(p.id, false);
    const { data: after } = await admin.from("parents").select("sms_opt_out_at, sms_promotional_opt_out_at").eq("id", p.id).single();
    expect(after!.sms_opt_out_at).toBeTruthy();
    expect(after!.sms_promotional_opt_out_at).toBeTruthy();
    const { data: log } = await admin.from("consent_log").select("kind, granted").eq("parent_id", p.id);
    expect(log!.map((l) => `${l.kind}:${l.granted}`).sort()).toEqual(["sms:false", "sms_promotional:false"]);

    await recordSmsChoice(p.id, true);
    expect((await queue(p.phone, "operational")).status).toBe("pending");
    expect((await queue(p.phone, "promotional")).status).toBe("skipped");
  });
});

describe("ingest from the website (v1.3)", () => {
  it("submit_registration_v2: sms_promotional follows the family onto the roster", async () => {
    const { programId } = await seedProgram();
    const yes = await registerV2(programId, { terms: true, sms: true, sms_promotional: true });
    const no = await registerV2(programId, { terms: true, sms: true, sms_promotional: false });

    // Before placement, the registration's own answer counts.
    expect((await queue(yes.phone, "promotional")).status).toBe("pending");
    expect((await queue(no.phone, "promotional")).status).toBe("skipped");
    expect((await queue(no.phone, "operational")).status).toBe("pending");

    await convertRegistration(yes.id);
    const { data: reg } = await admin.from("registrations").select("parent_id").eq("id", yes.id).single();
    const { data: p } = await admin.from("parents").select("sms_promotional_consent_at").eq("id", reg!.parent_id).single();
    expect(p!.sms_promotional_consent_at).toBeTruthy();
    const { data: log } = await admin.from("consent_log").select("kind, granted, source").eq("registration_id", yes.id);
    expect(log).toContainEqual({ kind: "sms_promotional", granted: true, source: "website_registration" });
  });

  it("a registration with only `sms` (an older form) gives no promotional consent", async () => {
    const { programId } = await seedProgram();
    const r = await registerV2(programId, { terms: true, sms: true });
    expect((await queue(r.phone, "promotional")).status).toBe("skipped");
  });

  it("submit_inquiry: the contact form's box sends both; it's recorded on the matching parent", async () => {
    const p = await parent();
    const { error } = await anonPublic.rpc("submit_inquiry", {
      p_kind: "general",
      p_contact: { phone: p.phone },
      p_details: { consents: { sms: true, sms_promotional: true, policy_version: "2026-10" } },
      p_attribution: null,
    });
    expect(error).toBeNull();
    const { data } = await admin.from("parents").select("sms_consent_at, sms_promotional_consent_at").eq("id", p.id).single();
    expect(data!.sms_promotional_consent_at).toBeTruthy();
    expect((await queue(p.phone, "promotional")).status).toBe("pending");

    // An inquiry with no phone can't carry a texts opt-in at all.
    const { data: id } = await anonPublic.rpc("submit_inquiry", {
      p_kind: "general",
      p_contact: { email: "nophone@example.com" },
      p_details: { consents: { sms: true, sms_promotional: true } },
      p_attribution: null,
    });
    const { data: inq } = await admin.from("inquiries").select("consents").eq("id", id).single();
    expect(inq!.consents).not.toHaveProperty("sms_promotional");
    expect(inq!.consents).not.toHaveProperty("sms");
  });

  it("an inquiry with sms only doesn't make that number eligible for promotions", async () => {
    const p = phone();
    await anonPublic.rpc("submit_inquiry", { p_kind: "general", p_contact: { phone: p }, p_details: { consents: { sms: true } }, p_attribution: null });
    expect((await queue(p, "promotional")).status).toBe("skipped");
    expect((await queue(p, "operational")).status).toBe("pending");
  });
});
