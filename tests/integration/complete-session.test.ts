import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { completeSession, recordAttendance } from "@/lib/actions/schedule";
import { addDays, businessToday } from "@/lib/dates";

/**
 * Mark Complete used to sit beside Save Attendance and ignore the register on
 * screen, so completing first left the practice with no attendance at all. It
 * also completed a practice two weeks away. Completing now saves the register
 * it is given, and only for a practice that has happened.
 */

afterEach(truncateAll);

async function practiceOn(date: string, children: string[] = ["Amina", "Bilal"]) {
  const { programId } = await seedProgram({});
  const { data: session } = await admin
    .from("sessions")
    .insert({ program_id: programId, date, start_time: "16:00", end_time: "17:00", status: "scheduled" })
    .select("id")
    .single();

  const studentIds: string[] = [];
  for (const first of children) {
    const { data: student } = await admin
      .from("students")
      .insert({ first_name: first, last_name: "Tester" })
      .select("id")
      .single();
    await admin
      .from("enrollments")
      .insert({ student_id: student!.id, program_id: programId, status: "active" });
    studentIds.push(student!.id);
  }
  return { sessionId: session!.id as string, studentIds };
}

async function statusOf(sessionId: string) {
  const { data } = await admin.from("sessions").select("status").eq("id", sessionId).single();
  return data!.status;
}

async function registerOf(sessionId: string) {
  const { data } = await admin
    .from("attendance")
    .select("student_id, status")
    .eq("session_id", sessionId);
  return Object.fromEntries((data ?? []).map((r) => [r.student_id, r.status]));
}

describe("completing a practice", () => {
  it("saves the register with it", async () => {
    const { sessionId, studentIds } = await practiceOn(businessToday());

    const result = await completeSession(sessionId, [
      { studentId: studentIds[0], status: "present" },
      { studentId: studentIds[1], status: "absent" },
    ]);

    expect(result.error).toBeUndefined();
    expect(await statusOf(sessionId)).toBe("completed");
    expect(await registerOf(sessionId)).toEqual({
      [studentIds[0]]: "present",
      [studentIds[1]]: "absent",
    });
  });

  it("refuses a practice that hasn't happened yet", async () => {
    const { sessionId, studentIds } = await practiceOn(addDays(businessToday(), 14));

    const result = await completeSession(sessionId, [
      { studentId: studentIds[0], status: "present" },
    ]);

    expect(result.error).toMatch(/hasn't happened yet/i);
    expect(await statusOf(sessionId)).toBe("scheduled");
    expect(await registerOf(sessionId)).toEqual({});
  });

  it("refuses a cancelled practice", async () => {
    const { sessionId } = await practiceOn(businessToday());
    await admin.from("sessions").update({ status: "cancelled", cancel_reason: "Gym closed" }).eq("id", sessionId);

    const result = await completeSession(sessionId, []);

    expect(result.error).toMatch(/cancelled/i);
    expect(await statusOf(sessionId)).toBe("cancelled");
  });

  it("completes a past practice", async () => {
    const { sessionId, studentIds } = await practiceOn(addDays(businessToday(), -3));

    const result = await completeSession(sessionId, [
      { studentId: studentIds[0], status: "late" },
      { studentId: studentIds[1], status: "excused" },
    ]);

    expect(result.error).toBeUndefined();
    expect(await statusOf(sessionId)).toBe("completed");
  });

  it("leaves the register open to correction afterwards", async () => {
    const { sessionId, studentIds } = await practiceOn(businessToday());
    await completeSession(sessionId, [
      { studentId: studentIds[0], status: "present" },
      { studentId: studentIds[1], status: "present" },
    ]);

    const result = await recordAttendance(sessionId, [
      { studentId: studentIds[1], status: "absent" },
    ]);

    expect(result.error).toBeUndefined();
    expect(await registerOf(sessionId)).toEqual({
      [studentIds[0]]: "present",
      [studentIds[1]]: "absent",
    });
    expect(await statusOf(sessionId)).toBe("completed");
  });
});
