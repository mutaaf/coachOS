"use server";

import { requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { foldName, phoneKey, sameFirstName, sameName } from "@/lib/identity";

/**
 * Bulk Import never adds someone already on file, or the same row twice: a
 * school with the same name, a parent with the same phone, a child with the
 * same name (lib/identity.ts). Those rows come back as errors saying so.
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

export async function bulkCreateStudents(
  rows: BulkStudentRow[]
): Promise<BulkImportResult> {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: { first_name: string; last_name: string; grade: string | null }[] = [];
  const validIndices: number[] = [];

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
    known.push({ first_name, last_name });
    validRows.push({
      first_name,
      last_name,
      grade: row.grade?.trim() || null,
    });
    validIndices.push(i);
  }

  if (validRows.length === 0) {
    return { created: 0, errors };
  }

  const { data, error } = await supabase
    .from("students")
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
    const key = phoneKey(row.phone);
    const holder = key ? byPhone.get(key) : undefined;
    if (holder) {
      errors.push({ row: i, message: `${row.phone.trim()} is already on file for ${holder} — not added again` });
      continue;
    }
    if (key) byPhone.set(key, `${row.first_name.trim()} ${row.last_name.trim()}`);
    const payment = row.preferred_payment?.trim().toLowerCase();
    const validPayment =
      payment === "zelle" || payment === "venmo" || payment === "stripe" ? payment : "cash";
    validRows.push({
      first_name: row.first_name.trim(),
      last_name: row.last_name.trim(),
      phone: row.phone.trim(),
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
