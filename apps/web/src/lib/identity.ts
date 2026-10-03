import type { OpsClient } from "@/lib/supabase/types";

/**
 * Is this child, parent or school already on file?
 *
 * Every way a person or school comes in — Add Student, Add Parent, a
 * registration added to the roster, a roster import, Bulk Import, a lead
 * converted to a school — asks here first. Each used to have its own idea of
 * "the same", and most had none: the same child was created twice, billed
 * twice, and a registration's allergy note went onto the copy while the
 * coach's register showed the original with no note.
 *
 * A parent is the same parent when the phone number is the same, however it
 * was typed. A child is the same child when a parent already has one with
 * that first name; a child with the same name under nobody we recognise is
 * only a possible match, for the Boss to confirm. A school is the same school
 * when the name is, ignoring case, accents and punctuation.
 *
 * Plain module, not "use server": every export of a server module is a public
 * endpoint. It is reached only from signed-in actions.
 */

/** "Mía", " MIA " and "mia" are one name; "St. Mary's" and "st marys" are one school. */
export function foldName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** For a search box: "jose" finds "José", "nunez" finds "Núñez". Keeps punctuation, so emails still match. */
export function searchable(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** "Mía" and "mia " are the same child; an accent added on re-import must not make a second one. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = foldName(a);
  return x !== "" && x === foldName(b);
}

/**
 * The same first name, allowing for a middle name one list has and another
 * doesn't: "Mia" and "Mia Sofia" are one child. "Ana Maria" and "Ana Lucia"
 * are not — twins can share a first word.
 */
export function sameFirstName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = foldName(a).split(" ").filter(Boolean);
  const y = foldName(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((word, i) => word === long[i]);
}

/** The last ten digits — how a stored number is compared, whatever format it was saved in. */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Does a search box's text find this number? "(214) 555", "214.555.1000" and
 * "555-1000" all find +12145551000. Only a search made of phone characters,
 * with at least three digits, is a phone search.
 */
export function matchesPhone(phone: string | null | undefined, query: string): boolean {
  if (!/^[\d\s()+.-]+$/.test(query)) return false;
  const q = query.replace(/\D/g, "");
  if (q.length < 3) return false;
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.includes(q) || (q.length === 11 && q.startsWith("1") && digits.endsWith(q.slice(1)));
}

/**
 * Add a note to the one on file without losing either. A registration's
 * "EpiPen — peanut allergy" must reach the child the coach sees.
 */
export function mergeNotes(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  const had = existing?.trim() || "";
  const add = incoming?.trim() || "";
  if (!add) return had || null;
  if (!had) return add;
  if (foldName(had).includes(foldName(add))) return had;
  return `${had}\n${add}`;
}

export interface ParentOnFile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface ChildOnFile {
  id: string;
  first_name: string;
  last_name: string;
  grade: string | null;
  date_of_birth: string | null;
  medical_notes: string | null;
  notes: string | null;
  status: string;
  parents: ParentOnFile[];
}

const CHILD_FIELDS =
  "id, first_name, last_name, grade, date_of_birth, medical_notes, notes, status, student_parents(parents(id, first_name, last_name, phone))";

function toChild(row: any): ChildOnFile {
  const { student_parents, ...child } = row;
  return {
    ...child,
    parents: (student_parents ?? []).map((sp: any) => sp.parents).filter(Boolean),
  };
}

/** Everyone on file, keyed for matching. Loaded once per import, not once per row. */
export class Directory {
  private constructor(
    private parents: ParentOnFile[],
    private children: ChildOnFile[],
  ) {}

  static async load(supabase: OpsClient): Promise<Directory> {
    const [{ data: parents, error: pe }, { data: children, error: ce }] = await Promise.all([
      supabase.from("parents").select("id, first_name, last_name, phone"),
      supabase.from("students").select(CHILD_FIELDS),
    ]);
    if (pe) throw pe;
    if (ce) throw ce;
    return new Directory((parents ?? []) as ParentOnFile[], (children ?? []).map(toChild));
  }

  /** The parent with this phone number, however either was typed. */
  parentByPhone(phone: string | null | undefined): ParentOnFile | null {
    const key = phoneKey(phone);
    if (!key) return null;
    return this.parents.find((p) => phoneKey(p.phone) === key) ?? null;
  }

  /** Children with this name, whoever their parents are. */
  childrenNamed(first: string | null | undefined, last: string | null | undefined): ChildOnFile[] {
    return this.children.filter((c) => sameName(c.last_name, last) && sameFirstName(c.first_name, first));
  }

  /**
   * Who this family is, if they're already on file.
   *
   * The parent is found by phone. The child is that parent's child with the
   * same first name — or, when the phone is new, a child with the same name
   * whose parent has the same name too: a family that changed numbers.
   * Anyone left over with the same name is a possible match, not a match.
   */
  family(input: {
    phone: string | null | undefined;
    parentFirst?: string | null;
    parentLast?: string | null;
    childFirst: string | null | undefined;
    childLast?: string | null;
  }): { parent: ParentOnFile | null; child: ChildOnFile | null; possible: ChildOnFile[] } {
    let parent = this.parentByPhone(input.phone);
    if (parent) {
      const child =
        this.children.find(
          (c) => c.parents.some((p) => p.id === parent!.id) && sameFirstName(c.first_name, input.childFirst)
        ) ?? null;
      return { parent, child, possible: child ? [] : this.childrenNamed(input.childFirst, input.childLast) };
    }

    const named = this.childrenNamed(input.childFirst, input.childLast);
    for (const child of named) {
      const sameParent = child.parents.find(
        (p) => sameName(p.first_name, input.parentFirst) && sameName(p.last_name, input.parentLast)
      );
      if (sameParent) {
        parent = this.parents.find((p) => p.id === sameParent.id) ?? sameParent;
        return { parent, child, possible: [] };
      }
    }
    return { parent: null, child: null, possible: named };
  }

  /** Remember someone just created, so a later row in the same import finds them. */
  addParent(parent: ParentOnFile) {
    this.parents.push(parent);
  }

  addChild(child: ChildOnFile) {
    this.children.push(child);
  }

  linkChild(childId: string, parent: ParentOnFile) {
    const child = this.children.find((c) => c.id === childId);
    if (child && !child.parents.some((p) => p.id === parent.id)) child.parents.push(parent);
  }
}

/** Children already on file with this name — the "Is this the same Mia?" list. */
export async function findChildrenNamed(
  supabase: OpsClient,
  first: string,
  last: string
): Promise<ChildOnFile[]> {
  const { data, error } = await supabase.from("students").select(CHILD_FIELDS);
  if (error) throw error;
  return (data ?? []).map(toChild).filter((c) => sameName(c.last_name, last) && sameFirstName(c.first_name, first));
}

/** The parent already on file with this phone number, if any. */
export async function findParentByPhone(supabase: OpsClient, phone: string): Promise<ParentOnFile | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const { data, error } = await supabase.from("parents").select("id, first_name, last_name, phone");
  if (error) throw error;
  return ((data ?? []) as ParentOnFile[]).find((p) => phoneKey(p.phone) === key) ?? null;
}

/** The school already on file with this name, ignoring case, accents and punctuation. */
export async function findSchoolNamed(
  supabase: OpsClient,
  name: string
): Promise<{ id: string; name: string; status: string } | null> {
  const { data, error } = await supabase.from("schools").select("id, name, status");
  if (error) throw error;
  return (data ?? []).find((s) => sameName(s.name, name)) ?? null;
}

/**
 * Bring what a second entry knew onto the child already on file: medical notes
 * and notes are added to, and a grade or birthday is filled in only where
 * there was none.
 */
export async function mergeIntoChild(
  supabase: OpsClient,
  child: Pick<ChildOnFile, "id" | "grade" | "date_of_birth" | "medical_notes" | "notes">,
  incoming: { grade?: string | null; date_of_birth?: string | null; medical_notes?: string | null; notes?: string | null }
) {
  const update: Record<string, string | null> = {};
  const medical = mergeNotes(child.medical_notes, incoming.medical_notes);
  if (medical !== (child.medical_notes ?? null)) update.medical_notes = medical;
  const notes = mergeNotes(child.notes, incoming.notes);
  if (notes !== (child.notes ?? null)) update.notes = notes;
  if (!child.grade && incoming.grade) update.grade = incoming.grade;
  if (!child.date_of_birth && incoming.date_of_birth) update.date_of_birth = incoming.date_of_birth;
  if (!Object.keys(update).length) return null;
  const { error } = await supabase.from("students").update(update).eq("id", child.id);
  if (error) throw error;
  return update;
}
