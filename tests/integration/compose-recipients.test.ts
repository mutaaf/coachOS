import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { fetchRecipients } from "@/lib/actions/messages";
import {
  initialSelection,
  recipientReducer,
  selectionKey,
  sendableRecipients,
  type RecipientEvent,
  type RecipientSelection,
} from "@/lib/recipient-selection";

/**
 * Issue #13: going from By School (one school) to By Program kept that school's
 * parents loaded while the dropdown showed another school's program, and a
 * message meant for one school's families was queued to the other's.
 */

afterEach(truncateAll);

async function family(programId: string, first: string, phone: string) {
  const { data: p } = await admin.from("parents").insert({ first_name: first, last_name: "Test", phone }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: `${first} Jr`, last_name: "Test" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
}

async function twoSchools() {
  const lakehill = await seedProgram({});
  const oakwood = await seedProgram({});
  await family(lakehill.programId, "Lena", "+12145550201");
  await family(lakehill.programId, "Luis", "+12145550202");
  await family(oakwood.programId, "Omar", "+12145550301");
  return { lakehill, oakwood };
}

const run = (events: RecipientEvent[], from: RecipientSelection = initialSelection) =>
  events.reduce(recipientReducer, from);

const names = (s: RecipientSelection) => sendableRecipients(s).map((r) => r.name).sort();

describe("Compose recipients", () => {
  it("By School → By Program drops the school's parents until a program is picked and loaded", async () => {
    const { lakehill, oakwood } = await twoSchools();

    let s = run([{ type: "mode", mode: "school" }, { type: "select", id: lakehill.schoolId }]);
    s = recipientReducer(s, { type: "loaded", key: selectionKey(s)!, recipients: await fetchRecipients("school", lakehill.schoolId) });
    expect(names(s)).toEqual(["Lena Test", "Luis Test"]);

    s = recipientReducer(s, { type: "mode", mode: "program" });
    expect(s.selectedId).toBe("");
    expect(sendableRecipients(s)).toEqual([]);

    s = recipientReducer(s, { type: "select", id: oakwood.programId });
    expect(sendableRecipients(s)).toEqual([]);
    s = recipientReducer(s, { type: "loaded", key: selectionKey(s)!, recipients: await fetchRecipients("program", oakwood.programId) });
    expect(names(s)).toEqual(["Omar Test"]);
  });

  it("All Parents → By School sends to nobody until a school is picked", async () => {
    const { oakwood } = await twoSchools();

    let s = run([{ type: "mode", mode: "all" }]);
    s = recipientReducer(s, { type: "loaded", key: "all", recipients: await fetchRecipients("all") });
    expect(names(s)).toHaveLength(3);

    s = recipientReducer(s, { type: "mode", mode: "school" });
    expect(sendableRecipients(s)).toEqual([]);

    s = recipientReducer(s, { type: "select", id: oakwood.schoolId });
    s = recipientReducer(s, { type: "loaded", key: selectionKey(s)!, recipients: await fetchRecipients("school", oakwood.schoolId) });
    expect(names(s)).toEqual(["Omar Test"]);
  });

  it("a slow list for a group she has moved off never replaces the one on screen", async () => {
    const { lakehill, oakwood } = await twoSchools();
    const lakehillParents = await fetchRecipients("school", lakehill.schoolId);

    let s = run([{ type: "mode", mode: "school" }, { type: "select", id: oakwood.schoolId }]);
    // Lakehill was picked first; its answer arrives after she switched to Oakwood.
    s = recipientReducer(s, { type: "loaded", key: `school:${lakehill.schoolId}`, recipients: lakehillParents });
    expect(sendableRecipients(s)).toEqual([]);

    // And after switching to By Program altogether.
    s = recipientReducer(s, { type: "mode", mode: "program" });
    s = recipientReducer(s, { type: "loaded", key: `school:${oakwood.schoolId}`, recipients: await fetchRecipients("school", oakwood.schoolId) });
    expect(sendableRecipients(s)).toEqual([]);
  });
});
