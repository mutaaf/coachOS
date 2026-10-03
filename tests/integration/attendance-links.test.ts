import { describe, it, expect, afterEach } from "vitest";
import { admin, anonPublic, anonOps, seedProgram, truncateAll } from "../helpers/db";
import {
  createAttendanceLink,
  revokeAttendanceLink,
} from "@/lib/actions/attendance-links";
import { cancelSession } from "@/lib/actions/schedule";
import { addDays, businessInstant, businessToday } from "@/lib/dates";

/**
 * A link that opens a register without an account is the widest thing in the
 * system. These tests are mostly about what it must NOT do.
 */

afterEach(truncateAll);

async function sessionWithRoster(children: { first: string; notes?: string }[] = []) {
  const { programId } = await seedProgram({});

  const { data: session } = await admin
    .from("sessions")
    .insert({
      program_id: programId,
      date: businessToday(),
      start_time: "16:00",
      end_time: "17:00",
      status: "scheduled",
    })
    .select("id")
    .single();

  const studentIds: string[] = [];
  for (const child of children) {
    const { data: student } = await admin
      .from("students")
      .insert({
        first_name: child.first,
        last_name: "Tester",
        medical_notes: child.notes ?? null,
      })
      .select("id")
      .single();
    await admin
      .from("enrollments")
      .insert({ student_id: student!.id, program_id: programId, status: "active" });
    studentIds.push(student!.id);
  }

  return { programId, sessionId: session!.id as string, studentIds };
}

function open(token: string, passcode: string) {
  return anonPublic.rpc("open_attendance_sheet", {
    p_token: token,
    p_passcode: passcode,
  });
}

describe("opening a sheet", () => {
  it("needs both the link and the passcode", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const wrong = await open(link.token!, "000000");
    expect(wrong.data.error).toMatch(/not right/i);
    expect(wrong.data.roster).toBeUndefined();

    const right = await open(link.token!, link.passcode!);
    expect(right.data.error).toBeUndefined();
    expect(right.data.roster).toHaveLength(1);
  });

  it("shows the session and its roster", async () => {
    const { sessionId } = await sessionWithRoster([
      { first: "Amina" },
      { first: "Bilal", notes: "Peanut allergy" },
    ]);
    const link = await createAttendanceLink(sessionId);

    const { data } = await open(link.token!, link.passcode!);

    expect(data.session.program_name).toMatch(/Test Program/);
    expect(data.roster.map((c: { first_name: string }) => c.first_name)).toEqual([
      "Amina",
      "Bilal",
    ]);
    // A coach mid-session is the person who needs to know about an allergy.
    expect(data.roster[1].medical_notes).toBe("Peanut allergy");
  });

  /**
   * The sheet is the one place children's names are reachable without a login,
   * so what it does NOT carry matters as much as what it does.
   */
  it("carries nothing beyond the register", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const { data } = await open(link.token!, link.passcode!);

    // Field names, not the text: ids are hex, and "…4fee…" is just an id.
    const keys: string[] = [];
    (function walk(v: unknown) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k.toLowerCase()); walk(x); }
    })(data);
    for (const forbidden of ["phone", "parent", "email", "amount", "fee", "invoice"]) {
      expect(keys.filter((k) => k.includes(forbidden)), forbidden).toEqual([]);
    }
    expect(Object.keys(data.roster[0]).sort()).toEqual([
      "first_name",
      "last_name",
      "medical_notes",
      "status",
      "student_id",
    ]);
  });

  it("gives the same answer for a bad passcode and a link that never existed", async () => {
    // Otherwise the endpoint becomes a way to discover which tokens are real.
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const badPasscode = await open(link.token!, "999999");
    const noSuchLink = await open("not-a-real-token", "999999");

    expect(badPasscode.data.error).toBe(noSuchLink.data.error);
  });

  it("locks after five wrong guesses, so six digits cannot be walked", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    for (let i = 0; i < 5; i++) await open(link.token!, "000000");

    // Even the correct passcode is refused while locked.
    const locked = await open(link.token!, link.passcode!);
    expect(locked.data.error).toMatch(/too many wrong passcodes/i);
  });

  it("clears the failure count once someone gets in", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    await open(link.token!, "000000");
    await open(link.token!, "000000");
    await open(link.token!, link.passcode!);

    const { data } = await admin
      .from("attendance_links")
      .select("failed_attempts, last_opened_at")
      .eq("session_id", sessionId)
      .single();
    expect(data!.failed_attempts).toBe(0);
    expect(data!.last_opened_at).not.toBeNull();
  });

  it("stops working once it expires", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);
    await admin
      .from("attendance_links")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("token", link.token!);

    const { data } = await open(link.token!, link.passcode!);
    expect(data.error).toMatch(/expired/i);
  });

  it("stops working when revoked", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    await revokeAttendanceLink(sessionId);

    const { data } = await open(link.token!, link.passcode!);
    expect(data.error).toMatch(/turned off/i);
  });

  it("issuing a new link kills the old one", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const first = await createAttendanceLink(sessionId);
    const second = await createAttendanceLink(sessionId);

    expect((await open(first.token!, first.passcode!)).data.error).toMatch(/turned off/i);
    expect((await open(second.token!, second.passcode!)).data.error).toBeUndefined();
  });
});

/**
 * A link made at 7:29pm for a 9am practice used to run out at 7:29am — before
 * the coach had even got to the field. It lasts until after the practice ends.
 */
describe("how long a link lasts", () => {
  async function sessionOn(date: string, start: string, end: string) {
    const { programId } = await seedProgram({});
    const { data } = await admin
      .from("sessions")
      .insert({ program_id: programId, date, start_time: start, end_time: end, status: "scheduled" })
      .select("id")
      .single();
    return data!.id as string;
  }

  it("still works when tomorrow morning's practice starts and ends", async () => {
    const tomorrow = addDays(businessToday(), 1);
    const sessionId = await sessionOn(tomorrow, "09:00", "10:00");

    const link = await createAttendanceLink(sessionId);

    const expires = new Date(link.expiresAt!);
    expect(expires.getTime()).toBeGreaterThan(businessInstant(tomorrow, "10:00").getTime());
  });

  it("lasts a few hours past the end, for a register filled in afterwards", async () => {
    const day = addDays(businessToday(), 5);
    const sessionId = await sessionOn(day, "16:00", "17:00");

    const link = await createAttendanceLink(sessionId);

    expect(new Date(link.expiresAt!).getTime()).toBe(
      businessInstant(day, "17:00").getTime() + 6 * 3_600_000
    );
  });

  it("gives a practice that already ended a fresh 12 hours", async () => {
    const sessionId = await sessionOn(addDays(businessToday(), -3), "16:00", "17:00");
    const before = Date.now();

    const link = await createAttendanceLink(sessionId);

    expect(new Date(link.expiresAt!).getTime()).toBeGreaterThanOrEqual(before + 12 * 3_600_000 - 1_000);
    expect((await open(link.token!, link.passcode!)).data.error).toBeUndefined();
  });
});

/**
 * A cancelled practice opened in the coach's register and saved attendance for
 * a practice that never happened.
 */
describe("a cancelled practice", () => {
  it("turns off its coach link when she cancels it", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    await cancelSession(sessionId, "Gym closed");

    const { data } = await open(link.token!, link.passcode!);
    expect(data.error).toBeDefined();
    expect(data.roster).toBeUndefined();
  });

  it("will not open or save even if a link is still live", async () => {
    const { sessionId, studentIds } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);
    // As if the link was never switched off: the database itself must refuse.
    await admin.from("sessions").update({ status: "cancelled" }).eq("id", sessionId);

    const opened = await open(link.token!, link.passcode!);
    expect(opened.data.error).toMatch(/cancelled/i);
    expect(opened.data.roster).toBeUndefined();

    const saved = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token,
      p_passcode: link.passcode,
      p_records: [{ student_id: studentIds[0], status: "present" }],
    });
    expect(saved.data.error).toMatch(/cancelled/i);

    const { count } = await admin
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(0);
  });

  it("only tells someone with the passcode that it was cancelled", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);
    await admin.from("sessions").update({ status: "cancelled" }).eq("id", sessionId);

    const { data } = await open(link.token!, "000000");
    expect(data.error).toMatch(/not right/i);
  });

  it("will not open once the practice is marked complete", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);
    await admin.from("sessions").update({ status: "completed" }).eq("id", sessionId);

    const { data } = await open(link.token!, link.passcode!);
    expect(data.error).toMatch(/finished/i);
    expect(data.roster).toBeUndefined();
  });
});

describe("saving the register", () => {
  it("records what the coach marked", async () => {
    const { sessionId, studentIds } = await sessionWithRoster([
      { first: "Amina" },
      { first: "Bilal" },
    ]);
    const link = await createAttendanceLink(sessionId);

    const { data: saved, error } = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token,
      p_passcode: link.passcode,
      p_records: [
        { student_id: studentIds[0], status: "present" },
        { student_id: studentIds[1], status: "late" },
      ],
    });

    expect(error).toBeNull();
    expect(saved.saved).toBe(2);

    const { data: rows } = await admin
      .from("attendance")
      .select("student_id, status, checked_in_at")
      .eq("session_id", sessionId);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.checked_in_at !== null)).toBe(true);
  });

  it("can be re-saved when the coach corrects themselves", async () => {
    const { sessionId, studentIds } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const records = (status: string) => ({
      p_token: link.token,
      p_passcode: link.passcode,
      p_records: [{ student_id: studentIds[0], status }],
    });

    await anonPublic.rpc("save_attendance_sheet", records("absent"));
    await anonPublic.rpc("save_attendance_sheet", records("present"));

    const { data: rows } = await admin
      .from("attendance")
      .select("status")
      .eq("session_id", sessionId);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("present");
  });

  /**
   * The token grants one session's register, not write access to attendance.
   */
  it("refuses a child who is not on this session's roster", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    const other = await sessionWithRoster([{ first: "Outsider" }]);
    const link = await createAttendanceLink(sessionId);

    const { data } = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token,
      p_passcode: link.passcode,
      p_records: [{ student_id: other.studentIds[0], status: "present" }],
    });

    expect(data.error).toMatch(/not on this session/i);
  });

  it("refuses an invented status", async () => {
    const { sessionId, studentIds } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const { data } = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token,
      p_passcode: link.passcode,
      p_records: [{ student_id: studentIds[0], status: "vibes" }],
    });

    expect(data.error).toMatch(/unknown attendance status/i);
  });

  it("refuses without the passcode", async () => {
    const { sessionId, studentIds } = await sessionWithRoster([{ first: "Amina" }]);
    const link = await createAttendanceLink(sessionId);

    const { data } = await anonPublic.rpc("save_attendance_sheet", {
      p_token: link.token,
      p_passcode: "000000",
      p_records: [{ student_id: studentIds[0], status: "present" }],
    });

    expect(data.error).toMatch(/not right/i);
    const { count } = await admin
      .from("attendance")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(0);
  });
});

describe("the link does not widen anon's reach", () => {
  it("still cannot read the operational tables", async () => {
    const { sessionId } = await sessionWithRoster([{ first: "Amina" }]);
    await createAttendanceLink(sessionId);

    for (const table of ["students", "attendance", "attendance_links", "parents"]) {
      const { data, error } = await anonOps.from(table).select("*");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("cannot mint its own link", async () => {
    // hash_passcode is for the owner issuing links, not for a visitor.
    const { error } = await anonPublic.rpc("hash_passcode", { p_passcode: "123456" });
    expect(error).not.toBeNull();
  });
});
