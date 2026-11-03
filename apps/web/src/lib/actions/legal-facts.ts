"use server";

import { revalidatePath } from "next/cache";
import { currentStaff, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createServerSupabase } from "@/lib/supabase/server";
import { invalidSources } from "@/lib/legal-facts";

/**
 * Policy facts: save a draft, mark one as needing research, send it for
 * review, or (admin only) publish to the website.
 *
 * Each runs as the signed-in person, through the database functions in
 * 20261007000400, which check the role again and write the audit log. The
 * compliance role can do everything here except publish.
 */

export interface FactInput {
  value: string;
  researchNotes?: string;
  sources?: string[];
}

type SaveStatus = "draft" | "needs_research" | "in_review";

const SUCCESS = { success: true as const };

async function save(key: string, input: FactInput, status: SaveStatus) {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  if (typeof key !== "string" || !key) return { error: "Which fact?" };
  const sources = (input?.sources ?? []).map((s) => String(s).trim()).filter(Boolean);
  const bad = invalidSources(sources);
  if (bad.length) return { error: `Not a web address: ${bad[0]}` };
  const { error } = await createServerSupabase().rpc("save_legal_fact", {
    p_key: key,
    p_value: String(input?.value ?? ""),
    p_research_notes: input?.researchNotes ?? null,
    p_sources: sources,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/compliance");
  return SUCCESS;
}

export async function saveFactDraft(key: string, input: FactInput) {
  return save(key, input, "draft");
}

export async function markFactNeedsResearch(key: string, input: FactInput) {
  return save(key, input, "needs_research");
}

export async function sendFactForReview(key: string, input: FactInput) {
  return save(key, input, "in_review");
}

export async function discardFactDraft(key: string) {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  const { error } = await createServerSupabase().rpc("discard_legal_fact_draft", { p_key: String(key ?? "") });
  if (error) return { error: error.message };
  revalidatePath("/compliance");
  return SUCCESS;
}

export interface PublishResult {
  success: true;
  published: string[];
  changed: string[];
  documents: { document: string; version: string }[];
}

/**
 * Publish everything in review (or only `keys`). Admin only — refused here
 * and again by ops.publish_legal_facts().
 */
export async function publishFacts(keys?: string[] | null): Promise<PublishResult | { error: string }> {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  if (staff.role !== "admin") return { error: "Only an admin can publish to the website. Send it for review instead." };
  const list = Array.isArray(keys) ? keys.map(String).filter(Boolean) : null;
  const { data, error } = await createServerSupabase().rpc("publish_legal_facts", { p_keys: list && list.length ? list : null });
  if (error) return { error: error.message };
  revalidatePath("/compliance");
  return { success: true, ...(data as Omit<PublishResult, "success">) };
}

/** Save the drawer's edits as in review and publish just that fact. Admin only. */
export async function publishFactNow(key: string, input: FactInput): Promise<PublishResult | { error: string }> {
  const staff = await currentStaff();
  if (!staff) return NOT_SIGNED_IN;
  if (staff.role !== "admin") return { error: "Only an admin can publish to the website. Send it for review instead." };
  const saved = await save(key, input, "in_review");
  if ("error" in saved && saved.error) return { error: saved.error };
  return publishFacts([key]);
}
