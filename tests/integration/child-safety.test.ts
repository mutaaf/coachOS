import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, anonOps, anonPublic, ensureOutsider, LOCAL, OUTSIDER, seedProgram, truncateAll } from "../helpers/db";
import { createAttendanceLink } from "@/lib/actions/attendance-links";
import { recordAttendance } from "@/lib/actions/schedule";
import { createIncident, recordReturnToPlay } from "@/lib/actions/incidents";
import { updateCoachSafeguarding } from "@/lib/actions/coaches";
import { getAssignableCoaches } from "@/lib/queries/coaches";
import { getCoachClearance } from "@/lib/queries/coach-clearance";
import { getFamily } from "@/lib/queries/families";
import { addMonths, evaluateClearance } from "@/lib/coach-clearance";
import { businessToday } from "@/lib/dates";

/**
 * Children's sensitive data and physical safety: medical notes reach only
 * admins and the assigned coach (and every view is logged); a child with a
 * suspected concussion can't be marked present until a doctor clears them;
 * and a coach who isn't cleared is flagged wherever they're assigned.
 */

afterEach(truncateAll);
beforeAll(ensureOutsider);

let n = 0;

async function coach(fields: Record<string, unknown> = {}) {
  const { data } = await admin
    .from("coaches")
    .insert({ first_name: "Coach", last_name: `C${++n}`, phone: `+1469555${String(n).padStart(4, "0")}`, ...fields })
    .select("id")
    .single();
  return data!.id as string;
}

async function practice(opts: { coachId?: string | null; notes?: string } = {}) {
  const { programId } = await seedProgram();
  const { data: session } = await admin
    .from("sessions")
    .insert({ program_id: programId, date: businessToday(), start_time: "16:00", end_time: "17:00", status: "scheduled", coach_id: opts.coachId ?? null })
    .select("id")
    .single();
  const { data: child } = await admin
    .from("students")
    .insert({ first_name: "Bilal", last_name: "T", medical_notes: opts.notes ?? "Peanut allergy", date_of_birth: "2018-01-01" })
    .select("id")
    .single();
  await admin.from("enrollments").insert({ student_id: child!.id, program_id: programId, status: "active" });
  return { programId, sessionId: session!.id as string, childId: child!.id as string };
}

const open = (token: string, passcode: string) => anonPublic.rpc("open_attendance_sheet", { p_token: token, p_passcode: passcode });

describe("medical notes and dates of birth", () => {
  it("are not readable by the public or by a signed-in account without the admin role (RLS, not just the UI)", async () => {
    await practice();
    expect((await anonOps.from("students").select("medical_notes, date_of_birth")).data).toBeNull();
    expect((await anonOps.from("registrations").select("medical_notes")).data).toBeNull();
    const outsider = createClient(LOCAL.url, LOCAL.anonKey, { db: { schema: "ops" }, auth: { persistSession: false } });
    await outsider.auth.signInWithPassword(OUTSIDER);
    expect((await outsider.from("students").select("medical_notes, date_of_birth")).data ?? []).toEqual([]);
    expect((await outsider.from("incidents").select("*")).data ?? []).toEqual([]);
    expect((await outsider.from("audit_log").select("*")).data ?? []).toEqual([]);
  });

  it("reach the coach assigned to the practice — and the view is logged — but no one else holding a link", async () => {
    const assigned = await coach();
    const { sessionId, childId } = await practice({ coachId: assigned });
    const link = await createAttendanceLink(sessionId);
    const { data } = await open(link.token!, link.passcode!);
    expect(data.medical_visible).toBe(true);
    expect(data.roster[0]).toMatchObject({ medical_notes: "Peanut allergy", has_medical_note: true, photo_ok: false });
    expect(JSON.stringify(data)).not.toMatch(/2018-01-01|date_of_birth/);

    const { data: audit } = await admin.from("audit_log").select("actor, detail").eq("action", "medical.view").eq("entity_id", sessionId);
    expect(audit).toHaveLength(1);
    expect(audit![0].detail).toMatchObject({ surface: "coach_register", coach_id: assigned, student_ids: [childId] });

    // The practice is handed to someone else: the old link no longer shows notes.
    await admin.from("sessions").update({ coach_id: await coach() }).eq("id", sessionId);
    const { data: after } = await open(link.token!, link.passcode!);
    expect(after.roster[0]).toMatchObject({ medical_notes: null, has_medical_note: true });
  });

  it("aren't shown on a register for a practice with no coach assigned", async () => {
    const { sessionId } = await practice();
    const link = await createAttendanceLink(sessionId);
    const { data } = await open(link.token!, link.passcode!);
    expect(data.medical_visible).toBe(false);
    expect(data.roster[0].medical_notes).toBeNull();
  });

  it("a dashboard page that shows them leaves an audit row naming the children", async () => {
    const { childId } = await practice();
    const { data: parent } = await admin.from("parents").insert({ first_name: "P", last_name: "T", phone: "+12145559999" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: childId, parent_id: parent!.id });
    await getFamily(parent!.id);
    const { data: audit } = await admin.from("audit_log").select("detail").eq("action", "medical.view");
    expect(audit!.some((a: any) => a.detail.surface === "family_page" && a.detail.student_ids.includes(childId))).toBe(true);
  });
});

describe("concussion: sit out until cleared in writing", () => {
  it("blocks marking the child present everywhere until the clearance is recorded", async () => {
    const cid = await coach();
    const { sessionId, childId, programId } = await practice({ coachId: cid });
    const fd = new FormData();
    fd.set("occurred_at", new Date(Date.now() - 3_600_000).toISOString());
    fd.set("kind", "injury");
    fd.set("student_id", childId);
    fd.set("program_id", programId);
    fd.set("description", "Collided with another player, head knock");
    fd.set("concussion_suspected", "on");
    const created = await createIncident(fd);
    expect(created).toMatchObject({ success: true });

    // Straight into the table: refused by the database.
    const { error } = await admin.from("attendance").insert({ session_id: sessionId, student_id: childId, status: "present" });
    expect(error?.message).toMatch(/suspected concussion/);
    // The dashboard's register: a plain message.
    expect(await recordAttendance(sessionId, [{ studentId: childId, status: "present" }])).toMatchObject({
      error: expect.stringMatching(/suspected concussion/),
    });
    // Excused is fine.
    expect(await recordAttendance(sessionId, [{ studentId: childId, status: "excused" }])).toMatchObject({ success: true });

    // The coach's register says they're sitting out, and won't save them as here.
    const link = await createAttendanceLink(sessionId);
    const { data: sheet } = await open(link.token!, link.passcode!);
    expect(sheet.roster[0].sitting_out).toBe(true);
    const { data: saved } = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token, p_passcode: link.passcode, p_records: [{ student_id: childId, status: "present" }],
    });
    expect(saved.error).toMatch(/sitting out/);

    // A clearance needs who signed it.
    const none = new FormData();
    expect(await recordReturnToPlay((created as { id: string }).id, none)).toMatchObject({ error: expect.any(String) });
    const ok = new FormData();
    ok.set("clearance_provider", "Dr. Patel, MD");
    expect(await recordReturnToPlay((created as { id: string }).id, ok)).toMatchObject({ success: true });
    expect(await recordAttendance(sessionId, [{ studentId: childId, status: "present" }])).toMatchObject({ success: true });
  });

  it("an incident needs a time and a description", async () => {
    expect(await createIncident(new FormData())).toMatchObject({ error: expect.any(String) });
    const fd = new FormData();
    fd.set("occurred_at", "2026-10-01T16:30");
    expect(await createIncident(fd)).toMatchObject({ error: /Describe/ });
  });
});

describe("coach clearance", () => {
  const today = "2026-10-05";
  const full = {
    id: "c",
    background_check_date: "2026-01-10",
    background_check_sex_offender_registry: true,
    abuse_training_date: "2025-06-01",
    abuse_training_expires_on: null,
    cpr_first_aid_expires_on: "2027-03-01",
    code_of_conduct_signed_on: "2026-01-10",
  };

  it("is cleared only with all four in date, and the check must include the registry", () => {
    expect(evaluateClearance(full, today).status).toBe("cleared");
    expect(evaluateClearance({ ...full, background_check_sex_offender_registry: false }, today)).toMatchObject({
      status: "not_cleared",
      problems: ["Background check"],
    });
    expect(evaluateClearance({ ...full, background_check_date: "2025-09-01" }, today).status).toBe("not_cleared");
    expect(evaluateClearance({ ...full, cpr_first_aid_expires_on: "2026-10-20" }, today).status).toBe("expiring");
    expect(evaluateClearance({ ...full, code_of_conduct_signed_on: null }, today).problems).toEqual(["Code of conduct"]);
    // Training lasts two years from the date unless the certificate says otherwise.
    expect(evaluateClearance({ ...full, abuse_training_date: "2024-09-01" }, today).status).toBe("not_cleared");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("is saved from the coach's safeguarding form and shown in the pickers", async () => {
    const id = await coach({ status: "active" });
    expect((await getCoachClearance(id))!.status).toBe("not_cleared");
    let picker = (await getAssignableCoaches()).find((c) => c.id === id)!;
    expect(picker.cleared).toBe(false);

    const fd = new FormData();
    fd.set("background_check_date", businessToday());
    expect(await updateCoachSafeguarding(id, fd)).toMatchObject({ error: /who ran/ });
    fd.set("background_check_provider", "Sterling");
    fd.set("background_check_sex_offender_registry", "on");
    fd.set("abuse_training_date", businessToday());
    fd.set("cpr_first_aid_expires_on", addMonths(businessToday(), 18));
    fd.set("code_of_conduct_signed_on", businessToday());
    expect(await updateCoachSafeguarding(id, fd)).toEqual({ success: true });

    expect((await getCoachClearance(id))!.status).toBe("cleared");
    picker = (await getAssignableCoaches()).find((c) => c.id === id)!;
    expect(picker.cleared).toBe(true);
  });
});
