"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
  const supabase = createServerSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: { name: string; address: string | null; contact_name: string | null; contact_phone: string | null; status: "active" }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.name || row.name.trim().length === 0) {
      errors.push({ row: i, message: "School name is required" });
      continue;
    }
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
  const supabase = createServerSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: { first_name: string; last_name: string; grade: string | null }[] = [];
  const validIndices: number[] = [];

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
    validRows.push({
      first_name: row.first_name.trim(),
      last_name: row.last_name.trim(),
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
  const supabase = createServerSupabase();
  const errors: { row: number; message: string }[] = [];
  const validRows: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string | null;
    preferred_payment: "cash" | "zelle" | "venmo";
  }[] = [];

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
    const payment = row.preferred_payment?.trim().toLowerCase();
    const validPayment =
      payment === "zelle" || payment === "venmo" ? payment : "cash";
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
