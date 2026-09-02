import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { getCoaches, getAssignableCoaches } from "@/lib/queries/coaches";
import {
  createCoach,
  updateCoach,
  deleteCoach,
  assignCoachToSession,
  assignCoachToTemplate,
} from "@/lib/actions/coaches";
import { businessToday } from "@/lib/dates";

afterEach(truncateAll);

function coachForm(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function addCoach(overrides: Record<string, string> = {}) {
  const result = await createCoach(
    coachForm({
      first_name: "Ahmed",
      last_name: "Rahman",
      phone: "+12145550001",
      pay_type: "per_session",
      pay_rate: "40",
      status: "active",
      source: "Facebook Marketplace",
      ...overrides,
    })
  );
  expect(result.error).toBeUndefined();

  const { data } = await admin
    .from("coaches")
    .select("*")
    .eq("phone", overrides.phone ?? "+12145550001")
    .single();
  return data!;
}

/** A session on a given date, so "worked" versus "upcoming" can be exercised. */
async function sessionOn(programId: string, date: string, coachId?: string) {
  const { data } = await admin
    .from("sessions")
    .insert({
      program_id: programId,
      date,
      start_time: "16:00",
      end_time: "17:00",
      status: "scheduled",
      coach_id: coachId ?? null,
    })
    .select("id")
    .single();
  return data!.id as string;
}

function daysFromToday(days: number) {
  const d = new Date(`${businessToday()}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("keeping a coach on file", () => {
  it("records the contact details and how they were found", async () => {
    const coach = await addCoach();

    expect(coach).toMatchObject({
      first_name: "Ahmed",
      phone: "+12145550001",
      status: "active",
      pay_type: "per_session",
      source: "Facebook Marketplace",
    });
    expect(Number(coach.pay_rate)).toBe(40);
  });

  it("insists on a name and a phone number", async () => {
    const result = await createCoach(coachForm({ first_name: "Ahmed", last_name: "" }));
    expect(result.error).toMatch(/first name, last name, and phone/i);
  });

  it("can be edited", async () => {
    const coach = await addCoach();

    await updateCoach(
      coach.id,
      coachForm({
        first_name: "Ahmed",
        last_name: "Rahman",
        phone: "+12145550002",
        pay_type: "per_session",
        pay_rate: "45",
        status: "active",
      })
    );

    const { data } = await admin.from("coaches").select("*").eq("id", coach.id).single();
    expect(data!.phone).toBe("+12145550002");
    expect(Number(data!.pay_rate)).toBe(45);
  });

  it("only offers active coaches for assignment", async () => {
    await addCoach();
    await addCoach({ first_name: "Sara", phone: "+12145550009", status: "inactive" });

    const assignable = await getAssignableCoaches();

    expect(assignable).toHaveLength(1);
    expect(assignable[0].first_name).toBe("Ahmed");
  });
});

describe("assigning coaches to work", () => {
  it("names who normally runs a weekly slot", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach();

    const { data: template } = await admin
      .from("schedule_templates")
      .insert({ program_id: programId, day_of_week: 2, start_time: "16:00", end_time: "17:00" })
      .select("id")
      .single();

    await assignCoachToTemplate(template!.id, coach.id);

    const [withWork] = await getCoaches();
    expect(withWork.weekly_slots).toBe(1);
  });

  it("records who actually ran one session, separately from the slot", async () => {
    // Substitutions are normal, and the session is what gets paid.
    const { programId } = await seedProgram({});
    const regular = await addCoach();
    const cover = await addCoach({ first_name: "Bilal", phone: "+12145550003" });

    const sessionId = await sessionOn(programId, daysFromToday(-1), regular.id);
    await assignCoachToSession(sessionId, cover.id);

    const coaches = await getCoaches();
    const byName = Object.fromEntries(coaches.map((c) => [c.first_name, c]));
    expect(byName.Bilal.sessions_completed).toBe(1);
    expect(byName.Ahmed.sessions_completed).toBe(0);
  });

  it("can unassign a session without deleting it", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach();
    const sessionId = await sessionOn(programId, daysFromToday(-1), coach.id);

    await assignCoachToSession(sessionId, null);

    const { data } = await admin.from("sessions").select("coach_id").eq("id", sessionId).single();
    expect(data!.coach_id).toBeNull();
  });
});

describe("what a coach is owed", () => {
  it("counts sessions that have happened, not ones still to come", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach({ pay_rate: "40" });

    await sessionOn(programId, daysFromToday(-7), coach.id);
    await sessionOn(programId, daysFromToday(-1), coach.id);
    await sessionOn(programId, daysFromToday(7), coach.id);

    const [withWork] = await getCoaches();

    expect(withWork.sessions_completed).toBe(2);
    expect(withWork.sessions_upcoming).toBe(1);
    expect(withWork.owed).toBe(80);
  });

  it("does not pay for a cancelled session", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach({ pay_rate: "40" });

    await sessionOn(programId, daysFromToday(-2), coach.id);
    const cancelled = await sessionOn(programId, daysFromToday(-1), coach.id);
    await admin.from("sessions").update({ status: "cancelled" }).eq("id", cancelled);

    const [withWork] = await getCoaches();
    expect(withWork.sessions_completed).toBe(1);
    expect(withWork.owed).toBe(40);
  });

  it("declines to guess for an hourly coach", async () => {
    // Nothing records hours, so a total would be invented rather than counted.
    const { programId } = await seedProgram({});
    const coach = await addCoach({ pay_type: "hourly", pay_rate: "25" });
    await sessionOn(programId, daysFromToday(-1), coach.id);

    const [withWork] = await getCoaches();
    expect(withWork.sessions_completed).toBe(1);
    expect(withWork.owed).toBeNull();
  });

  it("declines to guess when no rate is set", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach({ pay_rate: "" });
    await sessionOn(programId, daysFromToday(-1), coach.id);

    const [withWork] = await getCoaches();
    expect(withWork.owed).toBeNull();
  });
});

describe("removing a coach", () => {
  it("refuses while they are on sessions, so the history survives", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach();
    await sessionOn(programId, daysFromToday(-1), coach.id);

    const result = await deleteCoach(coach.id);

    expect(result.error).toMatch(/mark them inactive/i);

    const { count } = await admin
      .from("coaches")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(1);
  });

  it("allows it for someone who never worked", async () => {
    const coach = await addCoach();

    const result = await deleteCoach(coach.id);

    expect(result.error).toBeUndefined();
    const { count } = await admin
      .from("coaches")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("keeps who ran a session when a coach is made inactive instead", async () => {
    const { programId } = await seedProgram({});
    const coach = await addCoach();
    const sessionId = await sessionOn(programId, daysFromToday(-1), coach.id);

    await updateCoach(
      coach.id,
      coachForm({
        first_name: "Ahmed",
        last_name: "Rahman",
        phone: "+12145550001",
        status: "inactive",
        pay_type: "per_session",
        pay_rate: "40",
      })
    );

    const { data } = await admin.from("sessions").select("coach_id").eq("id", sessionId).single();
    expect(data!.coach_id).toBe(coach.id);

    // ...and they stop appearing in assignment lists.
    expect(await getAssignableCoaches()).toHaveLength(0);
  });
});
