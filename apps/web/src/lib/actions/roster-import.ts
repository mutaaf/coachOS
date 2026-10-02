"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { NOT_SIGNED_IN, signedIn } from "@/lib/auth-guard";
import { checkRows, importRows, rowsFromCsv, type RosterRow } from "@/lib/roster";
import { readRoster, type RosterInput } from "@/lib/roster-reader";

/**
 * The roster import wizard: read a list, check it, save it.
 *
 * Signed-in only (see lib/auth-guard.ts): reading a screenshot spends API
 * credit, and saving one writes parents and children.
 */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGES = 10;

/** Turn screenshots, a CSV, or pasted text into rows for the review screen. */
export async function readRosterSource(formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;

  const text = String(formData.get("text") ?? "");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  // A CSV, or a pasted table, with headers that say what each column is needs
  // no model at all — faster, free, and exact.
  const csvFiles = files.filter((f) => /\.(csv|tsv|txt)$/i.test(f.name) || f.type.startsWith("text/"));
  const images = files.filter((f) => (IMAGE_TYPES as readonly string[]).includes(f.type));
  const unsupported = files.filter((f) => !csvFiles.includes(f) && !images.includes(f));
  if (unsupported.length) {
    return {
      error: `Can't read ${unsupported.map((f) => f.name).join(", ")}. Use a screenshot (PNG or JPG) or a CSV — in Excel or Google Sheets, File → Download → CSV.`,
    };
  }
  if (images.length > MAX_IMAGES) return { error: `Up to ${MAX_IMAGES} screenshots at a time, please.` };

  const csvText = [text, ...(await Promise.all(csvFiles.map((f) => f.text())))].filter((t) => t.trim()).join("\n");

  if (images.length === 0) {
    if (!csvText.trim()) return { error: "Add a screenshot or a CSV, or paste the list in." };
    const local = rowsFromCsv(csvText);
    if (local && local.length) return { rows: local, notes: [] as string[], via: "csv" as const };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      error:
        "Reading screenshots isn't switched on yet. A CSV with column headers (child, parent, phone) works in the meantime.",
    };
  }

  const input: RosterInput = {
    images: await Promise.all(
      images.map(async (f) => ({
        mediaType: f.type as RosterInput["images"][number]["mediaType"],
        data: Buffer.from(await f.arrayBuffer()).toString("base64"),
      }))
    ),
    text: csvText || null,
  };

  try {
    const result = await readRoster(input);
    if (result.rows.length === 0) {
      return { error: "No names found in that. Is it the right screenshot?" };
    }
    return { ...result, via: "reader" as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The roster couldn't be read." };
  }
}

/** What the review screen shows beside each row: problems, and who is already on file. */
export async function checkRoster(programId: string | null, rows: RosterRow[]) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  return { checks: await checkRows(createAdminSupabase(), programId, rows) };
}

export interface ImportTarget {
  schoolId?: string;
  newSchoolName?: string;
  programId?: string;
  newProgram?: { name: string; monthlyFee: number };
}

/**
 * Save the reviewed rows onto a session, creating the school and the session
 * first when this is the first time they've been mentioned.
 */
export async function importRoster(target: ImportTarget, rows: RosterRow[]) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  let schoolId = target.schoolId;
  if (!schoolId) {
    const name = target.newSchoolName?.trim();
    if (!name) return { error: "Pick a school, or type the name of a new one." };
    const { data, error } = await supabase
      .from("schools")
      .insert({ name, status: "active" })
      .select("id")
      .single();
    if (error) return { error: error.message };
    schoolId = data.id as string;
  }

  let programId = target.programId;
  if (!programId) {
    const name = target.newProgram?.name?.trim();
    const fee = Number(target.newProgram?.monthlyFee);
    if (!name) return { error: "Pick a session, or name a new one." };
    if (!(fee > 0)) return { error: "What does this session cost per month?" };
    const { data, error } = await supabase
      .from("programs")
      .insert({
        school_id: schoolId,
        name,
        monthly_fee: fee,
        status: "active",
        // The roster is what actually happened; a cap below it would show the
        // session as over-full from day one.
        capacity: Math.max(12, rows.length),
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    programId = data.id as string;
  }

  const result = await importRows(supabase, programId, rows);

  revalidatePath("/schools");
  revalidatePath(`/schools/${schoolId}`);
  revalidatePath("/students");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return { success: true, schoolId, programId, ...result };
}
