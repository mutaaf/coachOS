import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { RETENTION, retentionDryRun, runRetention } from "@/lib/retention";
import { GET as cron } from "@/app/api/cron/retention/route";

/**
 * Personal data is kept only as long as it's needed. The nightly job removes
 * what's past its period and nothing else — never money, never an active
 * child's note — and a dry run changes nothing.
 */

afterEach(truncateAll);

const monthsAgo = (m: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString();
};

async function seed() {
  const { programId } = await seedProgram({ registrationOpen: true });
  const { data: oldInq } = await admin
    .from("inquiries")
    .insert({ kind: "general", phone: "+12145550001", first_name: "Old", message: "hi", created_at: monthsAgo(25) })
    .select("id")
    .single();
  const { data: newInq } = await admin
    .from("inquiries")
    .insert({ kind: "general", phone: "+12145550002", first_name: "New", created_at: monthsAgo(3) })
    .select("id")
    .single();

  const reg = (status: string, months: number, extra: Record<string, unknown> = {}) =>
    admin
      .from("registrations")
      .insert({
        program_id: programId, status, child_first_name: "Kid", child_last_name: "X", parent_first_name: "P",
        parent_last_name: "X", parent_phone: "+12145550003", medical_notes: "Nut allergy", amount: 150,
        created_at: monthsAgo(months), updated_at: monthsAgo(months), ...extra,
      })
      .select("id")
      .single()
      .then((r) => r.data!.id as string);
  const declinedOld = await reg("declined", 25);
  const waitlistOld = await reg("waitlisted", 30, { waitlist_position: 1 });
  const declinedNew = await reg("declined", 6);

  // A child who left 13 months ago, and one still enrolled.
  const { data: gone } = await admin.from("students").insert({ first_name: "Gone", last_name: "X", medical_notes: "Epipen", created_at: monthsAgo(30) }).select("id").single();
  await admin.from("enrollments").insert({ student_id: gone!.id, program_id: programId, status: "withdrawn", enrolled_at: monthsAgo(30), ended_at: monthsAgo(13) });
  const { data: here } = await admin.from("students").insert({ first_name: "Here", last_name: "X", medical_notes: "Asthma", created_at: monthsAgo(30) }).select("id").single();
  await admin.from("enrollments").insert({ student_id: here!.id, program_id: programId, status: "active", enrolled_at: monthsAgo(30) });

  return { oldInq: oldInq!.id, newInq: newInq!.id, declinedOld, waitlistOld, declinedNew, gone: gone!.id, here: here!.id };
}

describe("the retention job", () => {
  it("dry run counts what's past its period and changes nothing", async () => {
    const s = await seed();
    const result = await runRetention(admin, { dryRun: true });
    expect(result).toMatchObject({ dry_run: true, inquiries: 1, registrations: 2, medical_notes: 1 });
    const { data: inq } = await admin.from("inquiries").select("first_name").eq("id", s.oldInq).single();
    expect(inq!.first_name).toBe("Old");
    const { data: audit } = await admin.from("audit_log").select("action, detail").eq("action", "retention.dry_run");
    expect(audit!.length).toBeGreaterThan(0);
  });

  it("removes old contact details, unplaced registrations and stale medical notes — and nothing else", async () => {
    const s = await seed();
    await runRetention(admin, { dryRun: false });

    const { data: oldInq } = await admin.from("inquiries").select("*").eq("id", s.oldInq).single();
    expect(oldInq).toMatchObject({ first_name: null, phone: null, message: null, kind: "general" });
    expect(oldInq!.anonymized_at).toBeTruthy();
    const { data: newInq } = await admin.from("inquiries").select("first_name").eq("id", s.newInq).single();
    expect(newInq!.first_name).toBe("New");

    for (const id of [s.declinedOld, s.waitlistOld]) {
      const { data } = await admin.from("registrations").select("child_first_name, parent_phone, medical_notes, amount, status").eq("id", id).single();
      expect(data).toMatchObject({ child_first_name: "Removed", parent_phone: "removed", medical_notes: null, amount: 150 });
    }
    const { data: recent } = await admin.from("registrations").select("child_first_name").eq("id", s.declinedNew).single();
    expect(recent!.child_first_name).toBe("Kid");

    const { data: gone } = await admin.from("students").select("medical_notes, first_name").eq("id", s.gone).single();
    expect(gone).toEqual({ medical_notes: null, first_name: "Gone" });
    const { data: here } = await admin.from("students").select("medical_notes").eq("id", s.here).single();
    expect(here!.medical_notes).toBe("Asthma");

    // Run again: nothing left to do.
    expect(await runRetention(admin, { dryRun: false })).toMatchObject({ inquiries: 0, registrations: 0, medical_notes: 0 });
  });

  it("keeps a closed privacy request until its own, longer period", async () => {
    const base = { kind: "privacy_request", request_type: "access", privacy_status: "completed", due_at: monthsAgo(20), email: "a@example.com" };
    await admin.from("inquiries").insert([
      { ...base, created_at: monthsAgo(30) },
      { ...base, email: "b@example.com", created_at: monthsAgo(40) },
    ]);
    const result = await runRetention(admin, { dryRun: false });
    expect(result).toMatchObject({ inquiries: 0, privacy_requests: 1 });
    const { data } = await admin.from("inquiries").select("email").eq("kind", "privacy_request").order("created_at");
    expect(data!.map((r) => r.email)).toEqual([null, "a@example.com"]);
  });

  it("periods are configurable and must be sensible", async () => {
    expect(RETENTION).toEqual({ inquiryMonths: 24, registrationMonths: 24, medicalNoteMonths: 12, privacyRequestMonths: 36 });
    await seed();
    expect(await runRetention(admin, { dryRun: true, periods: { inquiryMonths: 1 } })).toMatchObject({ inquiries: 2 });
    await expect(runRetention(admin, { dryRun: true, periods: { medicalNoteMonths: 0 } })).rejects.toThrow(/at least a month/);
  });
});

describe("the nightly route", () => {
  const call = (q = "", auth = "Bearer test-cron") =>
    cron(new NextRequest(`http://localhost/api/cron/retention${q}`, { headers: { authorization: auth } }));

  it("refuses without the cron secret, and only counts until switched on", async () => {
    process.env.CRON_SECRET = "test-cron";
    expect((await call("", "Bearer nope")).status).toBe(401);

    await seed();
    delete process.env.RETENTION_ENABLED;
    expect(await (await call()).json()).toMatchObject({ dry_run: true, inquiries: 1 });

    process.env.RETENTION_ENABLED = "true";
    expect(await (await call("?dry_run=1")).json()).toMatchObject({ dry_run: true });
    expect(await (await call()).json()).toMatchObject({ dry_run: false, inquiries: 1 });
    delete process.env.RETENTION_ENABLED;
  });

  it("reads the switch", () => {
    expect(retentionDryRun({})).toBe(true);
    expect(retentionDryRun({ RETENTION_ENABLED: "true" })).toBe(false);
    expect(retentionDryRun({ RETENTION_ENABLED: "true" }, "1")).toBe(true);
  });
});
