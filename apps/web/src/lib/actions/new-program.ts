"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { stepProblems, toPayload, STEPS, type Draft, type FlowContext } from "@/lib/new-program";

/**
 * The "New program" flow's save: a program at one or more schools, its season,
 * weekly times, per-school fees/places/coaches and its website cards — in one
 * database transaction (ops.create_program_sessions). Every row or none.
 */

function refresh() {
  for (const p of ["/programs", "/schools", "/registrations", "/schedule", "/website", "/dashboard"]) revalidatePath(p);
}

export interface Created {
  catalog_id: string;
  season_id: string | null;
  sessions: { id: string; school_id: string; school_name: string; public_slug: string; listing_id: string | null }[];
}

export async function createProgramEverywhere(draft: Draft) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (!draft || typeof draft !== "object" || !Array.isArray((draft as Draft).schools)) {
    return { error: "Something was missing from the form. Reload the page and try again." };
  }
  const db = createAdminSupabase();

  // The same checks the page runs, against what's in the database now.
  const [catalog, seasons, coaches, photos] = await Promise.all([
    db.from("program_catalog").select("id, name, status"),
    db.from("seasons").select("id, name, status, start_date, end_date"),
    db.from("coaches").select("id"),
    db.from("site_media").select("id").eq("status", "ready"),
  ]);
  const ctx = {
    catalog: (catalog.data ?? []) as FlowContext["catalog"],
    seasons: (seasons.data ?? []) as FlowContext["seasons"],
    coaches: ((coaches.data ?? []) as { id: string }[]).map((c) => ({ id: c.id, name: "" })),
    photos: ((photos.data ?? []) as { id: string }[]).map((p) => ({ id: p.id, url: "", thumb: "", alt: "", focal_x: 0.5, focal_y: 0.5, live: true })),
    schools: [],
    sessions: [],
    today: "",
  } satisfies FlowContext;
  for (const step of STEPS) {
    const wrong = stepProblems(draft, ctx, step.id);
    if (wrong.length) return { error: wrong[0] };
  }

  const { data, error } = await db.rpc("create_program_sessions", { p: toPayload(draft) });
  if (error) {
    // The function's own messages are written for her; anything else isn't.
    if (error.code === "P0001") return { error: error.message };
    console.error("create_program_sessions failed:", error);
    return { error: "Nothing was saved — something went wrong on our side. Try again in a minute." };
  }
  refresh();
  return { success: true as const, created: data as Created };
}

/** Open or close sign-ups on several sessions at once. */
export async function setRegistrationOpen(sessionIds: string[], open: boolean) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const ids = Array.isArray(sessionIds) ? sessionIds.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : [];
  if (ids.length === 0) return { error: "Pick at least one session." };
  const { data, error } = await createAdminSupabase()
    .from("programs")
    .update({ registration_open: !!open })
    .in("id", ids)
    .select("id");
  if (error) return { error: error.message };
  refresh();
  return { success: true as const, count: (data ?? []).length };
}
