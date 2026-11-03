import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { admin, anonPublic, seedProgram, truncateAll } from "../helpers/db";
import { POST as notify } from "@/app/api/registrations/notify/route";

/**
 * /api/registrations/notify with a v2 token: only the browser that made the
 * registrations can trigger their emails or see the WhatsApp group link.
 */

const GROUP = "https://chat.whatsapp.com/Grp123456";
let saved: string | null = null;

beforeEach(async () => {
  const { data } = await admin.from("config").select("value").eq("key", "emails_enabled").single();
  saved = data!.value;
  await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
});
afterEach(async () => {
  await admin.from("config").update({ value: saved }).eq("key", "emails_enabled");
  delete process.env.NOTIFY_LEGACY_ENABLED;
  await admin.from("registration_submissions").delete().not("idempotency_key", "is", null);
  await truncateAll();
});

let n = 0;
async function signUp(programId: string, children: string[]) {
  const { data, error } = await anonPublic.rpc("submit_registration_v2", {
    p_offering_id: programId,
    p_parent: { first_name: "Ana", last_name: "Diaz", phone: `214555${String(7000 + ++n)}`, email: "ana@example.com" },
    p_children: children.map((first_name) => ({ first_name, last_name: "Diaz" })),
    p_consents: { terms: true },
    p_attribution: null,
    p_idempotency_key: randomUUID(),
  });
  if (error) throw error;
  return data as { notify_token: string; outcomes: { registration_id: string; status: string }[] };
}

async function ping(body: unknown) {
  const res = await notify(new NextRequest("http://x/api/registrations/notify", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

async function emailCount() {
  const { count } = await admin.from("emails").select("*", { count: "exact", head: true }).eq("kind", "registration");
  return count;
}

describe("notify with a token", () => {
  it("emails each child once and returns the group when a place was secured", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    const res = await signUp(programId, ["Leo", "Mia"]);
    const ids = res.outcomes.map((o) => o.registration_id);
    expect(res.outcomes.map((o) => o.status)).toEqual(["confirmed", "waitlisted"]);

    expect(await ping({ registration_ids: ids, token: res.notify_token })).toEqual({ status: 200, json: { ok: true, whatsappGroupUrl: GROUP } });
    expect(await emailCount()).toBe(2);
    await ping({ registration_ids: ids, token: res.notify_token });
    expect(await emailCount()).toBe(2);
  });

  it("gives the waitlist no group", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    await signUp(programId, ["First"]);
    const res = await signUp(programId, ["Second"]);
    const ids = res.outcomes.map((o) => o.registration_id);
    expect((await ping({ registration_ids: ids, token: res.notify_token })).json.whatsappGroupUrl).toBeNull();
  });

  it("refuses a forged, borrowed or malformed token", async () => {
    const { programId } = await seedProgram();
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    const a = await signUp(programId, ["Leo"]);
    const b = await signUp(programId, ["Mia"]);
    const aIds = a.outcomes.map((o) => o.registration_id);
    const bIds = b.outcomes.map((o) => o.registration_id);

    expect((await ping({ registration_ids: bIds, token: a.notify_token })).status).toBe(403);
    expect((await ping({ registration_ids: [...aIds, ...bIds], token: a.notify_token })).status).toBe(403);
    expect((await ping({ registration_ids: aIds, token: "v1.9999999999." + "0".repeat(64) })).status).toBe(403);
    expect((await ping({ registration_ids: aIds })).status).toBe(400);
    expect((await ping({ registration_ids: ["not-a-uuid"], token: a.notify_token })).status).toBe(400);
    expect(await emailCount()).toBe(0);
  });

  it("keeps the old body working until NOTIFY_LEGACY_ENABLED=false", async () => {
    const { programId } = await seedProgram();
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    await signUp(programId, ["Leo"]);
    const { data: reg } = await admin.from("registrations").select("parent_phone").single();
    const legacy = { program_id: programId, parent_phone: reg!.parent_phone, child_first_name: "leo" };

    expect((await ping(legacy)).json).toEqual({ ok: true, whatsappGroupUrl: GROUP });
    process.env.NOTIFY_LEGACY_ENABLED = "false";
    expect((await ping(legacy)).status).toBe(410);
  });
});
