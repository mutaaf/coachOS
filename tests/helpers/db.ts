import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Connection details for the local Supabase stack.
 *
 * Read from `supabase status` rather than hardcoded, so these tests keep
 * working if the local keys are ever rotated. They are read once per run.
 *
 * Everything here points at the throwaway local stack. Nothing in the test
 * suite is permitted to touch the production project — see the guard below.
 */
function repoRoot(): string {
  // Walk up from the working directory to the folder holding supabase/config.toml.
  // Vitest and Playwright invoke this from different places, and Playwright
  // compiles to CommonJS, so `import.meta.url` is not available here.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "supabase", "config.toml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Could not locate supabase/config.toml above " + process.cwd());
}

function readLocalStatus() {
  let raw: string;
  try {
    raw = execSync("supabase status -o json", {
      cwd: repoRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "The local Supabase stack is not running. Start it with `npm run db:start` before running tests."
    );
  }

  const status = JSON.parse(raw);
  return {
    url: status.API_URL as string,
    anonKey: status.ANON_KEY as string,
    serviceKey: status.SERVICE_ROLE_KEY as string,
  };
}

const local = readLocalStatus();

// A test run that somehow points at a hosted project would write real rows into
// the business's live data. Refuse to start rather than risk it.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(local.url)) {
  throw new Error(
    `Refusing to run tests against a non-local database: ${local.url}. Tests only ever run against the local Supabase stack.`
  );
}

export const LOCAL = local;

/** Service-role client, scoped to the operational schema. */
export const admin: SupabaseClient = createClient(local.url, local.serviceKey, {
  db: { schema: "ops" },
  auth: { persistSession: false },
});

/** Anonymous client against `ops` — used to prove it cannot read anything. */
export const anonOps: SupabaseClient = createClient(local.url, local.anonKey, {
  db: { schema: "ops" },
  auth: { persistSession: false },
});

/** Anonymous client against `public` — the marketing site's view of the world. */
export const anonPublic: SupabaseClient = createClient(local.url, local.anonKey, {
  auth: { persistSession: false },
});

/** Service-role client against `public`, for seeding CMS rows. */
export const adminPublic: SupabaseClient = createClient(local.url, local.serviceKey, {
  auth: { persistSession: false },
});

export interface SeededProgram {
  schoolId: string;
  programId: string;
  slug: string;
}

let seq = 0;

/**
 * Create a school and one program with the given capacity.
 *
 * Each call gets its own school and program so tests never contend over the
 * same seats, which matters because several of them deliberately race.
 */
export async function seedProgram(
  opts: { capacity?: number; registrationOpen?: boolean; monthlyFee?: number } = {}
): Promise<SeededProgram> {
  const { capacity = 12, registrationOpen = true, monthlyFee = 150 } = opts;
  const n = ++seq;
  const slug = `test-program-${Date.now()}-${n}`;

  const { data: school, error: schoolError } = await admin
    .from("schools")
    .insert({ name: `Test School ${n}`, status: "active" })
    .select("id")
    .single();
  if (schoolError) throw schoolError;

  const { data: program, error: programError } = await admin
    .from("programs")
    .insert({
      school_id: school.id,
      name: `Test Program ${n}`,
      monthly_fee: monthlyFee,
      status: "active",
      capacity,
      registration_open: registrationOpen,
      public_slug: slug,
    })
    .select("id")
    .single();
  if (programError) throw programError;

  return { schoolId: school.id, programId: program.id, slug };
}

/**
 * Register one child, going through the same database function the app and the
 * marketing site both call.
 */
export async function register(
  programId: string,
  childFirstName: string,
  overrides: Partial<{
    childLastName: string;
    parentFirstName: string;
    parentLastName: string;
    parentPhone: string;
    parentEmail: string;
    grade: string;
  }> = {}
) {
  return admin.rpc("submit_registration", {
    p_program_id: programId,
    p_child_first_name: childFirstName,
    p_child_last_name: overrides.childLastName ?? "Tester",
    p_parent_first_name: overrides.parentFirstName ?? "Parent",
    p_parent_last_name: overrides.parentLastName ?? "Tester",
    p_parent_phone: overrides.parentPhone ?? `+1214555${String(++seq).padStart(4, "0")}`,
    p_parent_email: overrides.parentEmail ?? null,
    p_child_grade: overrides.grade ?? null,
    p_child_date_of_birth: null,
    p_medical_notes: null,
    p_how_heard: null,
  });
}

/** Current seat accounting for a program. */
export async function availability(programId: string) {
  const { data, error } = await admin
    .from("program_availability")
    .select("capacity, seats_taken, seats_remaining, waitlist_count")
    .eq("program_id", programId)
    .single();
  if (error) throw error;
  return data as {
    capacity: number;
    seats_taken: number;
    seats_remaining: number;
    waitlist_count: number;
  };
}

/**
 * Remove everything the suite created. Deletes in dependency order and covers
 * every operational table, since the local database exists only for tests.
 */
export async function truncateAll() {
  for (const table of [
    "attendance",
    "registrations",
    "enrollments",
    "student_parents",
    "invoices",
    "payments",
    "sessions",
    "schedule_templates",
    "students",
    "parents",
    "coaches",
    "programs",
    "schools",
  ]) {
    const { error } = await admin
      .from(table)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    // student_parents has a composite key and no `id`; skip it politely.
    if (error && !/column .*id.* does not exist/i.test(error.message)) {
      throw new Error(`Failed clearing ${table}: ${error.message}`);
    }
  }
}

export const TEST_USER = {
  email: "test-owner@example.test",
  password: "test-password-1234",
};

/**
 * Ensure a confirmed account exists so end-to-end tests can sign in.
 *
 * The dashboard is the part of the product that holds every child's details,
 * and until this existed none of its signed-in behaviour could be tested — only
 * that signed-out visitors are turned away.
 */
export async function ensureTestUser() {
  const authAdmin = createClient(local.url, local.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await authAdmin.auth.admin.listUsers();
  const already = existing?.users?.find((u) => u.email === TEST_USER.email);
  if (already) return already.id;

  const { data, error } = await authAdmin.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}
