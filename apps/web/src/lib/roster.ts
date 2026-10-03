import type { OpsClient } from "@/lib/supabase/types";
import { Directory, phoneKey, type ChildOnFile } from "@/lib/identity";

/**
 * Getting a session's families into CoachOS from whatever the owner already
 * has: a screenshot of a spreadsheet or WhatsApp group, a CSV, or text pasted
 * from anywhere.
 *
 * Every source becomes the same rows, which the owner reviews and corrects
 * before anything is saved. Nothing here is a server action — the importer
 * writes parents and children, and is reached only through the signed-in
 * actions in lib/actions/roster-import.ts.
 */

export interface RosterRow {
  child_first_name: string | null;
  child_last_name: string | null;
  grade: string | null;
  parent_first_name: string | null;
  parent_last_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  /** Fields the reader could not make out clearly, for the review screen to flag. */
  uncertain?: string[];
}

/**
 * "(972) 891-8266", "972.891.8266" and "+1 972 891 8266" are one family.
 * US numbers become +1XXXXXXXXXX; anything else keeps its digits with a "+".
 * Null when there aren't enough digits to be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  // An extension is not part of the number: "214-555-0101 x12" read as digits
  // is a 12-digit number belonging to somebody else entirely.
  const text = (raw ?? "").replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Longer only if written as international ("+44 ..."); otherwise it is a
  // typo, and a typo must not become a real stranger's number.
  if (digits.length > 11 && digits.length <= 15 && text.startsWith("+")) return `+${digits}`;
  return null;
}

// Who counts as the same person is decided in one place, lib/identity.ts.
export { sameName, phoneKey } from "@/lib/identity";

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length ? s : null;
};

/**
 * "Mia Sofia Garcia" → ["Mia Sofia", "Garcia"]; a single word is a first name.
 * Every word before the last stays in the first name — dropping the middle
 * made "Mia Sofia" on one list and "Mia" on the next look like two children.
 */
export function splitName(full: string | null): [string | null, string | null] {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [null, null];
  if (parts.length === 1) return [parts[0], null];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180-ish: quoted fields, doubled quotes, commas or tabs. */
export function parseDelimited(text: string): string[][] {
  const delimiter = (text.split("\n")[0] ?? "").includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

type Column =
  | "child_first_name"
  | "child_last_name"
  | "child_full_name"
  | "grade"
  | "parent_first_name"
  | "parent_last_name"
  | "parent_full_name"
  | "parent_phone"
  | "parent_email";

const PARENT = /parent|guardian|mom|dad|mother|father|contact/;
const CHILD = /child|student|kid|player|participant|athlete/;

/** Which roster field a column header means, or null if it is none of them. */
function columnFor(header: string): Column | null {
  const h = header.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (/phone|mobile|cell|whatsapp|\btel\b/.test(h)) return "parent_phone";
  if (/e ?mail/.test(h)) return "parent_email";
  if (/grade|year|class/.test(h)) return "grade";

  const parent = PARENT.test(h);
  const first = /first|given/.test(h);
  const last = /last|surname|family/.test(h);

  if (parent) return first ? "parent_first_name" : last ? "parent_last_name" : "parent_full_name";
  if (CHILD.test(h) || first || last || h === "name" || h === "full name") {
    return first ? "child_first_name" : last ? "child_last_name" : "child_full_name";
  }
  return null;
}

/**
 * Read a CSV without asking a model, when its headers say what each column is.
 *
 * Returns null when the headers can't be understood — no child name and no
 * phone column — so the caller can hand it to the reader instead of guessing.
 */
export function rowsFromCsv(text: string): RosterRow[] | null {
  const table = parseDelimited(text);
  if (table.length < 2) return null;

  const columns = table[0].map(columnFor);
  const has = (c: Column) => columns.includes(c);
  const hasChild = has("child_first_name") || has("child_full_name");
  if (!hasChild && !has("parent_phone")) return null;

  return table.slice(1).map((cells) => {
    const get = (c: Column) => {
      const i = columns.indexOf(c);
      return i >= 0 ? clean(cells[i]) : null;
    };
    let [childFirst, childLast] = [get("child_first_name"), get("child_last_name")];
    if (!childFirst && get("child_full_name")) [childFirst, childLast] = splitName(get("child_full_name"));
    let [parentFirst, parentLast] = [get("parent_first_name"), get("parent_last_name")];
    if (!parentFirst && get("parent_full_name")) [parentFirst, parentLast] = splitName(get("parent_full_name"));

    return {
      child_first_name: childFirst,
      // A child's surname is usually the family's; the review screen shows it.
      child_last_name: childLast ?? parentLast,
      grade: get("grade"),
      parent_first_name: parentFirst,
      parent_last_name: parentLast ?? childLast,
      parent_phone: get("parent_phone"),
      parent_email: get("parent_email"),
    };
  });
}

// ---------------------------------------------------------------------------
// Checking and importing
// ---------------------------------------------------------------------------

export type RowCheck =
  | { ok: true; existingParent: string | null; alreadyEnrolled: boolean }
  | { ok: false; problem: string };

/** Who this row's family is on file as, if anyone. */
function familyOf(directory: Directory, row: RosterRow) {
  return directory.family({
    phone: row.parent_phone,
    parentFirst: clean(row.parent_first_name),
    parentLast: clean(row.parent_last_name),
    childFirst: clean(row.child_first_name),
    childLast: clean(row.child_last_name),
  });
}

/** What the review screen says about each row before anything is saved. */
export async function checkRows(
  supabase: OpsClient,
  programId: string | null,
  rows: RosterRow[]
): Promise<RowCheck[]> {
  const directory = await Directory.load(supabase);

  let enrolledStudentIds = new Set<string>();
  if (programId) {
    const { data } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("program_id", programId)
      .eq("status", "active");
    enrolledStudentIds = new Set((data || []).map((e) => e.student_id));
  }

  return rows.map((row) => {
    if (!clean(row.child_first_name)) return { ok: false, problem: "Child's first name is missing" };
    if (!clean(row.child_last_name)) return { ok: false, problem: "Child's last name is missing" };
    if (!phoneKey(row.parent_phone) || !normalizePhone(row.parent_phone)) {
      return { ok: false, problem: "Parent's phone number is missing or incomplete" };
    }
    const { parent, child } = familyOf(directory, row);
    if (!parent && !clean(row.parent_first_name)) {
      return { ok: false, problem: "Parent's name is missing" };
    }
    return {
      ok: true,
      existingParent: parent ? `${parent.first_name} ${parent.last_name}` : null,
      alreadyEnrolled: !!child && enrolledStudentIds.has(child.id),
    };
  });
}

export interface ImportResult {
  enrolled: number;
  alreadyEnrolled: number;
  newParents: number;
  skipped: { row: number; problem: string }[];
}

/**
 * Put each row's child on the program, creating the parent and child only when
 * they aren't already on file.
 *
 * Safe to run twice on the same list. Who is already on file is decided by
 * lib/identity.ts: a parent by phone number, whatever format either was typed
 * in; a child by that parent's child with the same first name, middle name or
 * not; and a family whose number changed by the child and parent both having
 * the same names. So importing a session's list again, or a sibling's session
 * that shares a parent, never makes duplicates.
 */
export async function importRows(
  supabase: OpsClient,
  programId: string,
  rows: RosterRow[]
): Promise<ImportResult> {
  const result: ImportResult = { enrolled: 0, alreadyEnrolled: 0, newParents: 0, skipped: [] };
  const checks = await checkRows(supabase, programId, rows);
  const directory = await Directory.load(supabase);

  for (let i = 0; i < rows.length; i++) {
    const check = checks[i];
    if (!check.ok) {
      result.skipped.push({ row: i, problem: check.problem });
      continue;
    }
    const row = rows[i];
    const childFirst = clean(row.child_first_name)!;
    const childLast = clean(row.child_last_name)!;

    // Looked up again rather than taken from the check: an earlier row in this
    // same list may have just created the family.
    let { parent, child } = familyOf(directory, row);
    if (!parent) {
      const { data, error } = await supabase
        .from("parents")
        .insert({
          first_name: clean(row.parent_first_name),
          last_name: clean(row.parent_last_name) ?? childLast,
          phone: normalizePhone(row.parent_phone),
          email: clean(row.parent_email),
          preferred_payment: "zelle",
        })
        .select("id, first_name, last_name, phone")
        .single();
      if (error) {
        result.skipped.push({ row: i, problem: error.message });
        continue;
      }
      parent = data;
      directory.addParent(data);
      result.newParents++;
    }

    if (!child) {
      const { data, error } = await supabase
        .from("students")
        .insert({ first_name: childFirst, last_name: childLast, grade: clean(row.grade) })
        .select("id, first_name, last_name, grade, date_of_birth, medical_notes, notes, status")
        .single();
      if (error) {
        result.skipped.push({ row: i, problem: error.message });
        continue;
      }
      child = { ...(data as Omit<ChildOnFile, "parents">), parents: [] };
      directory.addChild(child);
      await supabase
        .from("student_parents")
        .insert({ student_id: child.id, parent_id: parent.id, relationship: "parent" });
      directory.linkChild(child.id, parent);
    }
    const studentId = child.id;

    const { data: existing } = await supabase
      .from("enrollments")
      .select("id, status")
      .eq("student_id", studentId)
      .eq("program_id", programId)
      .maybeSingle();

    if (existing?.status === "active") {
      result.alreadyEnrolled++;
      continue;
    }

    const { error } = await supabase
      .from("enrollments")
      .upsert(
        { student_id: studentId, program_id: programId, status: "active" },
        { onConflict: "student_id,program_id" }
      );
    if (error) {
      result.skipped.push({ row: i, problem: error.message });
      continue;
    }
    result.enrolled++;
  }

  return result;
}
