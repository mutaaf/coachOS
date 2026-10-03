"use server";

import { requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { Directory, foldName, phoneKey, sameFirstName, sameName, type ParentOnFile } from "@/lib/identity";
import { normalizePhone, NOT_A_PHONE, splitName } from "@/lib/roster";

/**
 * Bulk Import never adds someone already on file, or the same row twice: a
 * school with the same name, a parent with the same phone, a child with the
 * same name (lib/identity.ts). Those rows come back as errors saying so. A
 * student row's parent is the exception: one already on file is linked, not
 * refused.
 */

export type BulkSchoolRow = {
  name: string;
  address?: string;
  contact_name?: string;
  contact_phone?: string;
};

export type BulkStudentRow = {
  first_name: string;
  last_name: string;
  grade?: string;
  parent_name?: string;
  parent_phone?: string;
};

export type BulkParentRow = {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  preferred_payment?: string;
};

export type BulkImportResult = {
  created: number;
  errors: { row: number; message: string }[];
};

export async function bulkCreateSchools(
  rows: BulkSchoolRow[]
): Promise<BulkImportResult> {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: { name: string; address: string | null; contact_name: string | null; contact_phone: string | null; status: "active" }[] = [];

  const { data: onFile } = await supabase.from("schools").select("name");
  const seen = new Set((onFile ?? []).map((s) => foldName(s.name)));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.name || row.name.trim().length === 0) {
      errors.push({ row: i, message: "School name is required" });
      continue;
    }
    const key = foldName(row.name);
    if (seen.has(key)) {
      errors.push({ row: i, message: `${row.name.trim()} is already on your list — not added again` });
      continue;
    }
    seen.add(key);
    validRows.push({
      name: row.name.trim(),
      address: row.address?.trim() || null,
      contact_name: row.contact_name?.trim() || null,
      contact_phone: row.contact_phone?.trim() || null,
      status: "active",
    });
  }

  if (validRows.length === 0) {
    return { created: 0, errors };
  }

  const { data, error } = await supabase
    .from("schools")
    .insert(validRows)
    .select();

  if (error) {
    return {
      created: 0,
      errors: [...errors, { row: -1, message: error.message }],
    };
  }

  revalidatePath("/schools");
  return { created: data?.length ?? 0, errors };
}

/**
 * A row's parent is found by phone, as lib/roster.ts does, and created only
 * when nobody on file has that number. Each child is saved linked to them —
 * a child with no parent has nobody to message and gets no invoices.
 */
export async function bulkCreateStudents(
  rows: BulkStudentRow[]
): Promise<BulkImportResult> {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const errors: { row: number; message: string }[] = [];
  let created = 0;

  const directory = await Directory.load(supabase);
  const { data: onFile } = await supabase.from("students").select("first_name, last_name");
  const known: { first_name: string; last_name: string }[] = [...(onFile ?? [])];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.first_name || row.first_name.trim().length === 0) {
      errors.push({ row: i, message: "First name is required" });
      continue;
    }
    if (!row.last_name || row.last_name.trim().length === 0) {
      errors.push({ row: i, message: "Last name is required" });
      continue;
    }
    const first_name = row.first_name.trim();
    const last_name = row.last_name.trim();
    if (known.some((s) => sameName(s.last_name, last_name) && sameFirstName(s.first_name, first_name))) {
      errors.push({
        row: i,
        message: `${first_name} ${last_name} is already on file — not added again. If it's a different child, use Add Student.`,
      });
      continue;
    }

    const parentName = row.parent_name?.trim() || "";
    const rawPhone = row.parent_phone?.trim() || "";
    let parent: ParentOnFile | null = null;
    if (rawPhone) {
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        errors.push({ row: i, message: `${rawPhone}: ${NOT_A_PHONE}` });
        continue;
      }
      parent = directory.parentByPhone(phone);
      if (!parent) {
        if (!parentName) {
          errors.push({ row: i, message: `Add the parent's name for ${rawPhone}, so they can be saved with ${first_name}` });
          continue;
        }
        const [parentFirst, parentLast] = splitName(parentName);
        const { data, error } = await supabase
          .from("parents")
          .insert({ first_name: parentFirst, last_name: parentLast ?? last_name, phone })
          .select("id, first_name, last_name, phone")
          .single();
        if (error) {
          errors.push({ row: i, message: error.message });
          continue;
        }
        parent = data as ParentOnFile;
        directory.addParent(parent);
      }
    } else if (parentName) {
      errors.push({ row: i, message: `Add ${parentName}'s phone number, so they can be saved with ${first_name}` });
      continue;
    }

    const { data: child, error } = await supabase
      .from("students")
      .insert({ first_name, last_name, grade: row.grade?.trim() || null })
      .select("id")
      .single();
    if (error) {
      errors.push({ row: i, message: error.message });
      continue;
    }
    known.push({ first_name, last_name });
    created++;
    if (parent) {
      const { error: linkError } = await supabase
        .from("student_parents")
        .insert({ student_id: child.id, parent_id: parent.id, relationship: "parent" });
      if (linkError) errors.push({ row: i, message: `${first_name} was added, but not linked to their parent: ${linkError.message}` });
    }
  }

  if (created > 0) revalidatePath("/students");
  return { created, errors };
}

export async function bulkCreateParents(
  rows: BulkParentRow[]
): Promise<BulkImportResult> {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string | null;
    preferred_payment: "cash" | "zelle" | "venmo" | "stripe";
  }[] = [];

  const { data: onFile } = await supabase.from("parents").select("first_name, last_name, phone");
  const byPhone = new Map<string, string>();
  for (const p of onFile ?? []) {
    const key = phoneKey(p.phone);
    if (key) byPhone.set(key, `${p.first_name} ${p.last_name}`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.first_name || row.first_name.trim().length === 0) {
      errors.push({ row: i, message: "First name is required" });
      continue;
    }
    if (!row.last_name || row.last_name.trim().length === 0) {
      errors.push({ row: i, message: "Last name is required" });
      continue;
    }
    if (!row.phone || row.phone.trim().length === 0) {
      errors.push({ row: i, message: "Phone number is required" });
      continue;
    }
    const phone = normalizePhone(row.phone);
    if (!phone) {
      errors.push({ row: i, message: `${row.phone.trim()}: ${NOT_A_PHONE}` });
      continue;
    }
    const key = phoneKey(phone)!;
    const holder = byPhone.get(key);
    if (holder) {
      errors.push({ row: i, message: `${row.phone.trim()} is already on file for ${holder} — not added again` });
      continue;
    }
    byPhone.set(key, `${row.first_name.trim()} ${row.last_name.trim()}`);
    const payment = row.preferred_payment?.trim().toLowerCase();
    const validPayment =
      payment === "zelle" || payment === "venmo" || payment === "stripe" ? payment : "cash";
    validRows.push({
      first_name: row.first_name.trim(),
      last_name: row.last_name.trim(),
      phone,
      email: row.email?.trim() || null,
      preferred_payment: validPayment,
    });
  }

  if (validRows.length === 0) {
    return { created: 0, errors };
  }

  const { data, error } = await supabase
    .from("parents")
    .insert(validRows)
    .select();

  if (error) {
    return {
      created: 0,
      errors: [...errors, { row: -1, message: error.message }],
    };
  }

  revalidatePath("/students");
  return { created: data?.length ?? 0, errors };
}
