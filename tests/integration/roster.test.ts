import { describe, it, expect, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { checkRows, importRows, normalizePhone, rowsFromCsv, type RosterRow } from "@/lib/roster";
import { readRoster, MODEL } from "@/lib/roster-reader";
import { importRoster, readRosterSource } from "@/lib/actions/roster-import";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Getting a session's families in from a screenshot or a spreadsheet.
 *
 * The property that matters is that importing never makes duplicates: the same
 * list imported twice, a parent typed in two formats, a family with children
 * in two sessions. Duplicate parents would mean duplicate payment links and
 * two WhatsApp messages for every reminder.
 */

const db = admin as unknown as OpsClient;

afterEach(truncateAll);

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  child_first_name: "Mia",
  child_last_name: "Garcia",
  grade: "K",
  parent_first_name: "Raquel",
  parent_last_name: "Garcia",
  parent_phone: "(915) 500-2487",
  parent_email: null,
  ...over,
});

async function counts() {
  const [p, s, e] = await Promise.all(
    ["parents", "students", "enrollments"].map((t) =>
      admin.from(t).select("id", { count: "exact", head: true })
    )
  );
  return { parents: p.count, students: s.count, enrollments: e.count };
}

describe("phone numbers", () => {
  it.each([
    ["(915) 500-2487", "+19155002487"],
    ["915.500.2487", "+19155002487"],
    ["+1 915 500 2487", "+19155002487"],
    ["19155002487", "+19155002487"],
    ["500-2487", null],
    ["", null],
  ])("reads %s as %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });
});

describe("reading a CSV without a model", () => {
  it("understands full-name columns", () => {
    const rows = rowsFromCsv("Child Name,Parent Name,Phone\nMia Garcia,Raquel Garcia,915-500-2487\n");
    expect(rows).toEqual([
      expect.objectContaining({
        child_first_name: "Mia",
        child_last_name: "Garcia",
        parent_first_name: "Raquel",
        parent_last_name: "Garcia",
        parent_phone: "915-500-2487",
      }),
    ]);
  });

  it("understands split columns, other words for the same thing, and quoted commas", () => {
    const rows = rowsFromCsv(
      'Student First,Student Last,Grade,Guardian,Cell,Email\nAda,Okafor,1st,"Okafor, Star",9728918266,star@example.com\n'
    );
    expect(rows![0]).toMatchObject({
      child_first_name: "Ada",
      child_last_name: "Okafor",
      grade: "1st",
      parent_phone: "9728918266",
      parent_email: "star@example.com",
    });
  });

  it("reads a table pasted from a spreadsheet, which arrives tab-separated", () => {
    const rows = rowsFromCsv("Child\tParent\tPhone\nJin Park\tYoomi Park\t240-393-6704");
    expect(rows![0]).toMatchObject({ child_first_name: "Jin", parent_first_name: "Yoomi" });
  });

  it("hands back to the reader when it can't tell what the columns are", () => {
    expect(rowsFromCsv("A,B,C\n1,2,3")).toBeNull();
    expect(rowsFromCsv("Mia Garcia 915-500-2487")).toBeNull();
  });
});

describe("importing a roster", () => {
  it("creates the family and puts the child on the session", async () => {
    const { programId } = await seedProgram({});

    const result = await importRows(db, programId, [row()]);

    expect(result).toMatchObject({ enrolled: 1, newParents: 1, skipped: [] });
    const { data: parent } = await admin.from("parents").select("phone, first_name").single();
    // Stored in one format, however it was typed.
    expect(parent).toEqual({ phone: "+19155002487", first_name: "Raquel" });
  });

  it("makes nothing twice when the same list is imported again", async () => {
    const { programId } = await seedProgram({});
    await importRows(db, programId, [row(), row({ child_first_name: "Leo" })]);

    const again = await importRows(db, programId, [row(), row({ child_first_name: "Leo" })]);

    expect(again).toMatchObject({ enrolled: 0, alreadyEnrolled: 2, newParents: 0 });
    expect(await counts()).toEqual({ parents: 1, students: 2, enrollments: 2 });
  });

  it("treats the same phone typed differently as the same parent", async () => {
    const { programId } = await seedProgram({});

    await importRows(db, programId, [
      row({ child_first_name: "Mia", parent_phone: "915-500-2487" }),
      row({ child_first_name: "Leo", parent_phone: "+1 (915) 500 2487" }),
    ]);

    expect(await counts()).toEqual({ parents: 1, students: 2, enrollments: 2 });
  });

  it("reuses the family when a child is in a second session", async () => {
    const first = await seedProgram({});
    const second = await seedProgram({});
    await importRows(db, first.programId, [row()]);

    const result = await importRows(db, second.programId, [row()]);

    expect(result).toMatchObject({ enrolled: 1, newParents: 0 });
    expect(await counts()).toEqual({ parents: 1, students: 1, enrollments: 2 });
  });

  it("matches a parent who registered through the website, whatever format they typed", async () => {
    const { programId } = await seedProgram({});
    await admin.from("parents").insert({ first_name: "Raquel", last_name: "Garcia", phone: "915-500-2487" });

    const result = await importRows(db, programId, [row({ parent_phone: "9155002487" })]);

    expect(result.newParents).toBe(0);
    expect((await counts()).parents).toBe(1);
  });

  it("skips rows it can't use, says why, and still imports the rest", async () => {
    const { programId } = await seedProgram({});

    const result = await importRows(db, programId, [
      row(),
      row({ child_first_name: "Leo", parent_phone: "500-2487" }),
      row({ child_first_name: null, parent_phone: "972-891-8266" }),
    ]);

    expect(result.enrolled).toBe(1);
    expect(result.skipped).toEqual([
      { row: 1, problem: "Parent's phone number is missing or incomplete" },
      { row: 2, problem: "Child's first name is missing" },
    ]);
  });

  it("tells the review screen who is already on file", async () => {
    const { programId } = await seedProgram({});
    await importRows(db, programId, [row()]);

    const checks = await checkRows(db, programId, [row(), row({ child_first_name: "Leo" })]);

    expect(checks[0]).toEqual({ ok: true, existingParent: "Raquel Garcia", alreadyEnrolled: true });
    expect(checks[1]).toEqual({ ok: true, existingParent: "Raquel Garcia", alreadyEnrolled: false });
  });
});

describe("reading screenshots", () => {
  function fakeClient(reply: Partial<{ stop_reason: string; parsed_output: unknown }>) {
    const calls: any[] = [];
    const client = {
      beta: {
        messages: {
          async parse(params: any) {
            calls.push(params);
            return { stop_reason: "end_turn", parsed_output: null, ...reply };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it("sends every screenshot and any pasted text, and returns the rows", async () => {
    const { client, calls } = fakeClient({
      parsed_output: { rows: [{ ...row(), uncertain: ["parent_phone"] }], notes: ["The bottom was cut off."] },
    });

    const result = await readRoster(
      {
        images: [
          { mediaType: "image/jpeg", data: "AAAA" },
          { mediaType: "image/png", data: "BBBB" },
        ],
        text: "also Leo",
      },
      client
    );

    expect(result.rows[0].uncertain).toEqual(["parent_phone"]);
    expect(result.notes).toEqual(["The bottom was cut off."]);
    const req = calls[0];
    expect(req.model).toBe(MODEL);
    expect(req.fallbacks).toBe("default");
    expect(req.messages[0].content.filter((b: any) => b.type === "image")).toHaveLength(2);
    expect(JSON.stringify(req.messages[0].content)).toContain("also Leo");
  });

  it("says so when the reply can't be used, rather than returning nothing", async () => {
    await expect(
      readRoster({ images: [{ mediaType: "image/jpeg", data: "A" }] }, fakeClient({ stop_reason: "refusal" }).client)
    ).rejects.toThrow(/couldn't be read/);
    await expect(
      readRoster({ images: [{ mediaType: "image/jpeg", data: "A" }] }, fakeClient({ stop_reason: "max_tokens" }).client)
    ).rejects.toThrow(/too long/);
  });
});

describe("the wizard's actions", () => {
  it("refuse anyone who isn't signed in", async () => {
    (globalThis as any).__signedOut = true;
    // Reading a screenshot spends API credit and importing writes families;
    // an action's id is all a stranger would need to call it.
    const fd = new FormData();
    fd.set("text", "Child,Parent,Phone\nMia Garcia,Raquel Garcia,9155002487");

    expect(await readRosterSource(fd)).toHaveProperty("error", expect.stringMatching(/sign in/i));
    expect(await importRoster({ newSchoolName: "X", newProgram: { name: "Y", monthlyFee: 100 } }, [row()])).toHaveProperty(
      "error",
      expect.stringMatching(/sign in/i)
    );
    expect((await counts()).parents).toBe(0);
  });
});
