"use server";

import { currentUser } from "@/lib/auth-guard";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { listReleases, unseen, type Release } from "@/lib/releases";

export interface ReleaseState {
  current: string | null;
  /** Releases since she last looked; empty until she has finished the first tour. */
  unseen: Release[];
}

export async function getReleaseState(): Promise<ReleaseState | null> {
  const user = await currentUser();
  if (!user) return null;
  const releases = await listReleases(createAdminSupabase(), 20);
  const { data } = await createServerSupabase().auth.getUser();
  const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    current: releases[0]?.version ?? null,
    // The first-login tour already covers everything; "what's new" starts after it.
    unseen: meta.tour_completed_at ? unseen(releases, meta.last_seen_release as string | undefined) : [],
  };
}
