import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, anonOps, anonPublic, seedProgram, sql, truncateAll } from "../helpers/db";

/**
 * public.submit_registration_v2: the website signs a family's children up in
 * one call. All or nothing, safe to send twice, and it hands back a token
 * that proves which registrations it just made.
 */

afterEach(async () => {
  await admin.from("registration_submissions").delete().not("idempotency_key", "is", null);
  await truncateAll();
});

let n = 0;
const phone = () => `(972) 555-${String(++n).padStart(4, "0")}`;

function v2(
  programId: string,
  over: Partial<{ parent: unknown; children: unknown; consents: unknown; attribution: unknown; key: string | null }> = {}
) {
  return anonPublic.rpc("submit_registration_v2", {
    p_offering_id: programId,
    p_parent: over.parent ?? { first_name: "Sara", last_name: "Yusuf", phone: phone(), email: "Sara@Example.com", how_heard: "A friend" },
    p_children: over.children ?? [{ first_name: "Amina", last_name: "Yusuf", grade: "1st", date_of_birth: "2019-04-02", medical_notes: "Asthma" }],
    p_consents: over.consents ?? { terms: true, medical: true, photo: false, policy_version: "2026-10" },
    p_attribution: over.attribution ?? { last_touch: { utm_source: "google", utm_medium: "cpc", junk: 1 } },
    p_idempotency_key: over.key === undefined ? randomUUID() : over.key,
  });
}

async function rows(programId: string) {
  const { data } = await admin.from("registrations").select("*").eq("program_id", programId).order("created_at");
  return data ?? [];
}

describe("submit_registration_v2", () => {
  it("registers siblings together, seats first, then the waitlist, and stores consents and attribution", async () => {
    const { programId } = await seedProgram({ capacity: 2, monthlyFee: 120 });
    const kids = ["Amina", "Bilal", "Zara"].map((first_name) => ({ first_name, last_name: "Yusuf" }));
    const { data, error } = await v2(programId, { children: kids });
    expect(error).toBeNull();
    expect(data.notify_token).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
    expect(data.outcomes.map((o: any) => [o.child_first_name, o.child_last_name, o.status, o.waitlist_position])).toEqual([
      ["Amina", "Yusuf", "confirmed", null],
      ["Bilal", "Yusuf", "confirmed", null],
      ["Zara", "Yusuf", "waitlisted", 1],
    ]);

    const saved = await rows(programId);
    expect(saved.map((r) => r.id)).toEqual(data.outcomes.map((o: any) => o.registration_id));
    expect(saved[0]).toMatchObject({
      parent_phone: expect.stringMatching(/^\+1972555\d{4}$/),
      parent_email: "sara@example.com",
      how_heard: "A friend",
      amount: 120,
      attribution: { last_touch: { utm_source: "google", utm_medium: "cpc" } },
      consents: { terms: true, medical: true, photo: false, policy_version: "2026-10" },
    });
    expect(saved[0].consents.accepted_at).toBeTruthy();

    // Anon learned outcomes only, and can't read anything back.
    expect((await anonOps.from("registrations").select("*")).data).toBeNull();
  });

  it("is all or nothing", async () => {
    const { programId } = await seedProgram();
    const { error } = await v2(programId, { children: [{ first_name: "Amina", last_name: "Yusuf" }, { first_name: "", last_name: "Yusuf" }] });
    expect(error?.message).toMatch(/each child's first and last name/);
    expect(await rows(programId)).toHaveLength(0);

    const closed = await seedProgram({ registrationOpen: false });
    expect((await v2(closed.programId)).error?.message).toMatch(/Registration is closed for/);
    expect(await rows(closed.programId)).toHaveLength(0);
  });

  it("returns the first answer for the same idempotency key, even sent twice at once", async () => {
    const { programId } = await seedProgram();
    const key = randomUUID();
    const parent = { first_name: "Sara", last_name: "Yusuf", phone: phone() };
    const [a, b] = await Promise.all([v2(programId, { key, parent }), v2(programId, { key, parent })]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(b.data).toEqual(a.data);
    const again = await v2(programId, { key, parent });
    expect(again.data).toEqual(a.data);
    expect(await rows(programId)).toHaveLength(1);

    const other = await seedProgram();
    expect((await v2(other.programId, { key, parent })).error?.message).toMatch(/different program/);
  });

  it("refuses without the terms, a phone, or a sensible date of birth", async () => {
    const { programId } = await seedProgram();
    expect((await v2(programId, { consents: { terms: false } })).error?.message).toMatch(/accept the terms/);
    expect((await v2(programId, { consents: "yes" })).error?.message).toMatch(/accept the terms/);
    expect((await v2(programId, { parent: { first_name: "S", last_name: "Y", phone: "12" } })).error?.message).toMatch(/phone number/);
    expect((await v2(programId, { children: [] })).error?.message).toMatch(/at least one child/);
    expect(
      (await v2(programId, { children: [{ first_name: "Amina", last_name: "Y", date_of_birth: "next tuesday" }] })).error?.message
    ).toMatch(/Amina's date of birth/);
    expect(await rows(programId)).toHaveLength(0);
  });

  it("keeps v1's throttle: ten children an hour from one number", async () => {
    const { programId } = await seedProgram({ capacity: 50 });
    const parent = { first_name: "P", last_name: "T", phone: phone() };
    const eight = Array.from({ length: 8 }, (_, i) => ({ first_name: `C${i}`, last_name: "T" }));
    expect((await v2(programId, { parent, children: eight })).error).toBeNull();
    const three = eight.slice(0, 3);
    expect((await v2(programId, { parent, children: three })).error?.message).toMatch(/Too many registrations from this number/);
    expect((await v2(programId, { parent, children: three.slice(0, 2) })).error).toBeNull();
  });
});

describe("the notify token", () => {
  async function verify(ids: string[], token: string) {
    const { data, error } = await admin.rpc("verify_notify_token", { p_registration_ids: ids, p_token: token });
    expect(error).toBeNull();
    return data as boolean;
  }

  it("verifies for exactly the registrations it was issued for, in any order", async () => {
    const { programId } = await seedProgram();
    const { data } = await v2(programId, { children: [{ first_name: "A", last_name: "Y" }, { first_name: "B", last_name: "Y" }] });
    const ids = data.outcomes.map((o: any) => o.registration_id);
    expect(await verify(ids, data.notify_token)).toBe(true);
    expect(await verify([...ids].reverse(), data.notify_token)).toBe(true);
    expect(await verify([ids[0]], data.notify_token)).toBe(false);
    expect(await verify([...ids, randomUUID()], data.notify_token)).toBe(false);
    expect(await verify(ids, data.notify_token.replace(/.$/, (c: string) => (c === "0" ? "1" : "0")))).toBe(false);
    expect(await verify(ids, "nonsense")).toBe(false);
  });

  it("expires after an hour", async () => {
    const id = randomUUID();
    const past = Math.floor(Date.now() / 1000) - 1;
    const [{ sig }] = sql<{ sig: string }>(`SELECT ops.notify_token_signature(ARRAY['${id}']::uuid[], ${past}) AS sig`);
    expect(await verify([id], `v1.${past}.${sig}`)).toBe(false);
    const future = past + 120;
    const [{ sig: ok }] = sql<{ sig: string }>(`SELECT ops.notify_token_signature(ARRAY['${id}']::uuid[], ${future}) AS sig`);
    expect(await verify([id], `v1.${future}.${ok}`)).toBe(true);
  });

  it("keeps its secret from every API role, the service role included", async () => {
    expect((await admin.from("app_secrets").select("*")).error).not.toBeNull();
    expect((await anonOps.rpc("verify_notify_token", { p_registration_ids: [randomUUID()], p_token: "x" })).error).not.toBeNull();
    const [grants] = sql<Record<string, boolean>>(`
      SELECT has_table_privilege('service_role', 'ops.app_secrets', 'SELECT') AS service,
             has_table_privilege('authenticated', 'ops.app_secrets', 'SELECT') AS authed,
             has_function_privilege('anon', 'ops.verify_notify_token(uuid[], text)', 'EXECUTE') AS anon_verify,
             has_function_privilege('service_role', 'ops.notify_token_signature(uuid[], bigint)', 'EXECUTE') AS service_sign`);
    expect(grants).toEqual({ service: false, authed: false, anon_verify: false, service_sign: false });
  });
});
