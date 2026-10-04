import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateSessions, updateScheduleTemplate } from "@/lib/actions/schedule";
import { getCoaches } from "@/lib/queries/coaches";
import { addDays, businessToday } from "@/lib/dates";

/**
 * Changing a Saturday practice from 9:00 to 9:15 and generating again put two
 * practices on every Saturday, and generated practices never carried the
 * weekly slot's coach — so coach pay came up short.
 */

afterEach(truncateAll);

async function addCoach(firstName: string, phone: string) {
  const { data, error } = await admin
    .from("coaches")
    .insert({
      first_name: firstName,
      last_name: "Coach",
      phone,
      pay_type: "per_session",
      pay_rate: 40,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function weeklySlot(programId: string, coachId: string | null, dayOfWeek = 6) {
  const { data, error } = await admin
    .from("schedule_templates")
    .insert({
      program_id: programId,
      day_of_week: dayOfWeek,
      start_time: "09:00",
      end_time: "10:00",
      location: "Main Gym",
      coach_id: coachId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function slotForm(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function practices(programId: string) {
  const { data } = await admin
    .from("sessions")
    .select("date, start_time, end_time, coach_id, status")
    .eq("program_id", programId)
    .order("date");
  return data!;
}

describe("generated practices take the weekly slot's coach", () => {
  it("copies the coach onto every practice it creates", async () => {
    const { programId } = await seedProgram({});
    const coachId = await addCoach("Ahmed", "+12145550001");
    await weeklySlot(programId, coachId);

    await generateSessions(programId, 4);

    const rows = await practices(programId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.coach_id === coachId)).toBe(true);
  });

  it("counts them towards what the coach is owed once they have happened", async () => {
    const { programId } = await seedProgram({});
    const coachId = await addCoach("Ahmed", "+12145550001");
    await weeklySlot(programId, coachId);
    await generateSessions(programId, 4);

    // Move the first one into the past, as time would.
    const [first] = await practices(programId);
    await admin
      .from("sessions")
      .update({ date: addDays(businessToday(), -1) })
      .eq("program_id", programId)
      .eq("date", first.date);

    const [coach] = await getCoaches();
    expect(coach.sessions_completed).toBe(1);
    expect(coach.owed).toBe(40);
  });
});

describe("changing a weekly slot", () => {
  it("does not put a second practice on the same day after the time changes", async () => {
    const { programId } = await seedProgram({});
    const slot = await weeklySlot(programId, null);
    await generateSessions(programId, 4);

    await updateScheduleTemplate(
      slot.id,
      slotForm({
        program_id: programId,
        day_of_week: "6",
        start_time: "09:15",
        end_time: "10:15",
        location: "Main Gym",
        update_future: "false",
      })
    );
    await generateSessions(programId, 4);

    const rows = await practices(programId);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.date)).size).toBe(4);
  });

  it("moves the practices already on the calendar to the new time when asked", async () => {
    const { programId } = await seedProgram({});
    const slot = await weeklySlot(programId, null);
    await generateSessions(programId, 4);

    const result = await updateScheduleTemplate(
      slot.id,
      slotForm({
        program_id: programId,
        day_of_week: "6",
        start_time: "09:15",
        end_time: "10:15",
        location: "Main Gym",
        update_future: "true",
      })
    );
    expect(result.error).toBeUndefined();

    const rows = await practices(programId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.start_time.startsWith("09:15"))).toBe(true);
    expect(rows.every((r) => r.end_time.startsWith("10:15"))).toBe(true);
  });

  it("moves them to the new day of the week", async () => {
    const { programId } = await seedProgram({});
    // Friday to Saturday, so no practice is moved into the past.
    const slot = await weeklySlot(programId, null, 5);
    await generateSessions(programId, 4);
    const before = (await practices(programId)).map((r) => r.date);

    await updateScheduleTemplate(
      slot.id,
      slotForm({
        program_id: programId,
        day_of_week: "6",
        start_time: "09:00",
        end_time: "10:00",
        update_future: "true",
      })
    );

    const after = (await practices(programId)).map((r) => r.date);
    expect(after).toEqual(before.map((d) => addDays(d, 1)));
  });

  it("leaves past and cancelled practices as they were", async () => {
    const { programId } = await seedProgram({});
    const slot = await weeklySlot(programId, null);
    await generateSessions(programId, 2);
    const [first, second] = await practices(programId);
    const yesterday = addDays(businessToday(), -1);
    await admin.from("sessions").update({ date: yesterday }).eq("program_id", programId).eq("date", first.date);
    await admin
      .from("sessions")
      .update({ status: "cancelled", cancel_reason: "Gym closed" })
      .eq("program_id", programId)
      .eq("date", second.date);

    await updateScheduleTemplate(
      slot.id,
      slotForm({
        program_id: programId,
        day_of_week: "6",
        start_time: "09:15",
        end_time: "10:15",
        update_future: "true",
      })
    );

    const rows = await practices(programId);
    expect(rows.every((r) => r.start_time.startsWith("09:00"))).toBe(true);
  });

  it("hands upcoming practices to a new coach, but keeps someone covering", async () => {
    const { programId } = await seedProgram({});
    const regular = await addCoach("Ahmed", "+12145550001");
    const cover = await addCoach("Bilal", "+12145550002");
    const next = await addCoach("Sara", "+12145550003");
    const slot = await weeklySlot(programId, regular);
    await generateSessions(programId, 3);
    const [first] = await practices(programId);
    await admin.from("sessions").update({ coach_id: cover }).eq("program_id", programId).eq("date", first.date);

    await updateScheduleTemplate(
      slot.id,
      slotForm({
        program_id: programId,
        day_of_week: "6",
        start_time: "09:00",
        end_time: "10:00",
        coach_id: next,
        update_future: "true",
      })
    );

    const rows = await practices(programId);
    expect(rows.map((r) => r.coach_id)).toEqual([cover, next, next]);
  });
});
