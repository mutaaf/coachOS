import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { cancelSession } from "@/lib/actions/schedule";
import { submitRegistration, convertRegistration, promoteNextInLine, promoteFromWaitlist } from "@/lib/actions/registrations";
import { deleteMessageTemplate } from "@/lib/actions/messages";
import { POST as notify } from "@/app/api/registrations/notify/route";
import { GET as cron } from "@/app/api/cron/daily-reminders/route";
import { addDays, businessToday } from "@/lib/dates";
import { NextRequest } from "next/server";

/**
 * Messages the app promised and never sent (issue #26). Cancelling a practice
 * told nobody; /join said "we'll message you" when a place opened and nothing
 * did; and Settings offered reminder times and templates no code ever used.
 */

let saved: { key: string; value: string }[] = [];
const KEYS = ["emails_enabled", "welcome_message_enabled"];

beforeEach(async () => {
  const { data } = await admin.from("config").select("key, value").in("key", KEYS);
  saved = data ?? [];
  await admin.from("config").update({ value: "true" }).in("key", KEYS);
});
afterEach(async () => {
  for (const s of saved) await admin.from("config").update({ value: s.value }).eq("key", s.key);
  await truncateAll();
});
afterAll(truncateAll);

async function outbox() {
  const { data } = await admin
    .from("message_queue")
    .select("recipient_name, recipient_phone, message, status, template_id")
    .order("created_at");
  return data ?? [];
}

async function emails(kind: string) {
  const { data } = await admin.from("emails").select("kind, to_address, subject, body_text").eq("kind", kind);
  return data ?? [];
}

function form(programId: string, over: Record<string, string> = {}) {
  const f = new FormData();
  const fields = {
    program_id: programId,
    child_first_name: "Mia",
    child_last_name: "Garcia",
    parent_first_name: "Raquel",
    parent_last_name: "Garcia",
    parent_phone: "(214) 555-0150",
    parent_email: "raquel@example.com",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** A family of two children on one program's roster, and one on another. */
async function rosterWithSession(date: string) {
  const { programId } = await seedProgram();
  await admin.from("programs").update({ name: "Hoops" }).eq("id", programId);
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145550150" })
    .select("id")
    .single();
  const { data: noPhone } = await admin
    .from("parents")
    .insert({ first_name: "Nophone", last_name: "Lee", phone: "" })
    .select("id")
    .single();
  const { data: kids } = await admin
    .from("students")
    .insert([
      { first_name: "Mia", last_name: "Garcia" },
      { first_name: "Leo", last_name: "Garcia" },
      { first_name: "Withdrawn", last_name: "Kid" },
    ])
    .select("id, first_name");
  const [mia, leo, gone] = kids!;
  await admin.from("student_parents").insert([
    { student_id: mia.id, parent_id: parent!.id, relationship: "parent" },
    { student_id: leo.id, parent_id: parent!.id, relationship: "parent" },
    { student_id: gone.id, parent_id: noPhone!.id, relationship: "parent" },
  ]);
  await admin.from("enrollments").insert([
    { student_id: mia.id, program_id: programId, status: "active" },
    { student_id: leo.id, program_id: programId, status: "active" },
    { student_id: gone.id, program_id: programId, status: "withdrawn" },
  ]);
  const { data: session } = await admin
    .from("sessions")
    .insert({ program_id: programId, date, start_time: "16:00", end_time: "17:00", status: "scheduled" })
    .select("id")
    .single();
  return { programId, sessionId: session!.id as string };
}

describe("cancelling a practice", () => {
  it("puts a message to each enrolled family in the Outbox, once per family", async () => {
    const date = addDays(businessToday(), 3);
    const { sessionId } = await rosterWithSession(date);

    const result: any = await cancelSession(sessionId, "gym closed");
    expect(result.error).toBeUndefined();
    expect(result.data.queued).toBe(1);

    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].recipient_name).toBe("Raquel Garcia");
    expect(queued[0].recipient_phone).toBe("+12145550150");
    expect(queued[0].status).toBe("pending");
    expect(queued[0].template_id).not.toBeNull();
    expect(queued[0].message).toContain("Hi Raquel");
    expect(queued[0].message).toContain("Hoops");
    expect(queued[0].message).toContain("gym closed");

    // Pressed twice: still one message.
    await cancelSession(sessionId, "gym closed");
    expect(await outbox()).toHaveLength(1);
  });

  it("tells nobody about a practice that has already happened", async () => {
    const { sessionId } = await rosterWithSession(addDays(businessToday(), -2));
    const result: any = await cancelSession(sessionId, "recording it late");
    expect(result.data.queued).toBe(0);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("signing up", () => {
  it("a family with a place gets an Outbox message as well as the email, once", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    await submitRegistration(form(programId));

    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].recipient_phone).toBe("+12145550150");
    expect(queued[0].message).toContain("Mia");
    expect(await emails("registration")).toHaveLength(1);

    // The website's ping and the daily sweep ask again: still one of each.
    await notify(
      new NextRequest("http://x/api/registrations/notify", {
        method: "POST",
        body: JSON.stringify({ program_id: programId, parent_phone: "2145550150", child_first_name: "Mia" }),
      })
    );
    process.env.CRON_SECRET = "test-cron";
    await cron(new NextRequest("http://x/api/cron/daily-reminders", { headers: { authorization: "Bearer test-cron" } }));
    expect(await outbox()).toHaveLength(1);
    expect(await emails("registration")).toHaveLength(1);
  });

  it("a family on the waitlist is told their place in line", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await submitRegistration(form(programId, { child_first_name: "First", parent_phone: "2145550001", parent_email: "" }));
    await submitRegistration(form(programId));

    const mine = (await outbox()).find((m) => m.recipient_phone === "+12145550150")!;
    expect(mine.message).toMatch(/waitlist/i);
    expect(mine.message).toContain("#1");
  });
});

describe("a place opens", () => {
  async function fullWithOneWaiting() {
    const { programId } = await seedProgram({ capacity: 1 });
    await submitRegistration(form(programId, { child_first_name: "First", parent_phone: "2145550001", parent_email: "" }));
    await submitRegistration(form(programId));
    const { data: first } = await admin
      .from("registrations")
      .select("id")
      .eq("program_id", programId)
      .eq("child_first_name", "First")
      .single();
    await admin.from("registrations").update({ status: "cancelled" }).eq("id", first!.id);
    await admin.from("message_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { data: waiting } = await admin
      .from("registrations")
      .select("id")
      .eq("program_id", programId)
      .eq("child_first_name", "Mia")
      .single();
    return { programId, waitingId: waiting!.id as string };
  }

  it("giving the seat to the next in line messages and emails that family", async () => {
    const { programId } = await fullWithOneWaiting();
    expect(await promoteNextInLine(programId)).toMatchObject({ success: true });

    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].recipient_phone).toBe("+12145550150");
    expect(queued[0].message).toMatch(/spot/i);
    expect(queued[0].message).toContain("Mia");

    const [seat] = await emails("seat");
    expect(seat.to_address).toBe("raquel@example.com");
    expect(seat.subject).toContain("Mia");
  });

  it("giving a particular family the seat does the same", async () => {
    const { waitingId } = await fullWithOneWaiting();
    expect(await promoteFromWaitlist(waitingId)).toMatchObject({ success: true });
    expect(await outbox()).toHaveLength(1);
    expect(await emails("seat")).toHaveLength(1);
  });
});

describe("on the roster", () => {
  it("adding a sign-up to the roster puts the welcome message in the Outbox", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    await submitRegistration(form(programId));
    await admin.from("message_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { data: reg } = await admin.from("registrations").select("id").eq("program_id", programId).single();

    expect(await convertRegistration(reg!.id)).toEqual({ success: true });
    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].message).toMatch(/^Welcome to/);
    expect(queued[0].message).toContain("Mia");
  });

  it("not when Welcome Messages is off", async () => {
    await admin.from("config").update({ value: "false" }).eq("key", "welcome_message_enabled");
    const { programId } = await seedProgram({ capacity: 5 });
    await submitRegistration(form(programId));
    await admin.from("message_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { data: reg } = await admin.from("registrations").select("id").eq("program_id", programId).single();
    await convertRegistration(reg!.id);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("nothing promised that isn't sent", () => {
  it("the reminder times and other settings nothing reads are gone", async () => {
    const { data } = await admin
      .from("config")
      .select("key")
      .in("key", ["day_before_reminder_time", "morning_reminder_time", "message_rate_limit_seconds"]);
    expect(data).toEqual([]);
  });

  it("the templates nothing sends are gone, and the ones the app sends can't be deleted", async () => {
    const { data } = await admin.from("message_templates").select("id, name");
    const names = (data ?? []).map((t) => t.name);
    expect(names).not.toContain("practice_reminder_morning");
    expect(names).not.toContain("payment_received");
    for (const sent of ["session_cancelled", "welcome_message", "registration_received", "waitlist_joined", "waitlist_seat"]) {
      expect(names).toContain(sent);
      const id = data!.find((t) => t.name === sent)!.id;
      await expect(deleteMessageTemplate(id)).rejects.toThrow(/sent automatically/);
    }
  });
});
