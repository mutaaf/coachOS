import type { OpsClient } from "@/lib/supabase/types";

/**
 * Releases: strict MAJOR.MINOR.PATCH, one per merge that changes something.
 * Written by the release workflow through /api/releases; read by "What's new".
 */

export interface ReleaseNote {
  text: string;
  /** A tour stop that shows this, for "Show me". */
  tourStep?: string;
}

export interface Release {
  version: string;
  title: string;
  summary: string;
  notes: ReleaseNote[];
  technical: string[];
  released_at: string;
}

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export async function listReleases(supabase: OpsClient, limit = 50): Promise<Release[]> {
  const { data } = await supabase
    .from("releases")
    .select("version, title, summary, notes, technical, released_at")
    .limit(500);
  return ((data || []) as Release[]).sort((a, b) => compareVersions(b.version, a.version)).slice(0, limit);
}

/**
 * Releases she hasn't seen. Someone who has never looked is shown only the
 * latest — not the whole history on her first day.
 */
export function unseen(releases: Release[], lastSeen: string | null | undefined): Release[] {
  if (!releases.length) return [];
  if (!lastSeen || !SEMVER.test(lastSeen)) return releases.slice(0, 1);
  return releases.filter((r) => compareVersions(r.version, lastSeen) > 0);
}

export interface ReleaseInput {
  version: string;
  title: string;
  summary?: string;
  notes?: ReleaseNote[];
  technical?: string[];
  sha?: string;
  /** GitHub issue numbers this release fixes; reports filed as those are marked fixed. */
  fixes?: number[];
}

export async function recordRelease(supabase: OpsClient, input: ReleaseInput) {
  if (!SEMVER.test(input.version ?? "")) return { error: "version must be MAJOR.MINOR.PATCH" };
  if (!input.title?.trim()) return { error: "title is required" };
  const notes = (Array.isArray(input.notes) ? input.notes : [])
    .filter((n) => n && typeof n.text === "string" && n.text.trim())
    .map((n) => ({ text: n.text.trim(), ...(n.tourStep ? { tourStep: String(n.tourStep) } : {}) }));

  const { error } = await supabase.from("releases").upsert({
    version: input.version,
    title: input.title.trim(),
    summary: (input.summary ?? "").trim(),
    notes,
    technical: (input.technical ?? []).map(String).slice(0, 200),
    sha: input.sha ?? null,
  });
  if (error) return { error: error.message };

  const fixes = (input.fixes ?? []).map(Number).filter(Number.isInteger);
  let fixedReports = 0;
  if (fixes.length) {
    const { data } = await supabase
      .from("problem_reports")
      .update({ status: "fixed", fixed_in: input.version })
      .in("issue_number", fixes)
      .neq("status", "fixed")
      .select("id");
    fixedReports = data?.length ?? 0;
  }
  return { success: true as const, fixedReports };
}
