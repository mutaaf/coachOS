"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN, currentUser } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { businessToday } from "@/lib/dates";
import { familyHref } from "@/lib/family-link";
import { APPEAL_DAYS, EXTENSION_DAYS, addDaysTo, canMove, STATUS_LABEL } from "@/lib/privacy";
import type { PrivacyStatus } from "@/types/database";

/**
 * Working a privacy request, admin only. Every step is audited.
 *
 * Erasing a family needs the request to be at "Checking it's them" or later:
 * nobody's data is deleted on an unverified ask.
 */

const UUID = /^[0-9a-f-]{36}$/i;

async function loadRequest(id: string) {
  const { data } = await createAdminSupabase()
    .from("inquiries")
    .select("id, kind, request_type, privacy_status, due_at, extended_at, parent_id")
    .eq("id", id)
    .eq("kind", "privacy_request")
    .maybeSingle();
  return data as
    | { id: string; kind: string; request_type: string; privacy_status: PrivacyStatus; due_at: string; extended_at: string | null; parent_id: string | null }
    | null;
}

/** Move a request along: verifying → done, or declined with the reason, an appeal… */
export async function updatePrivacyStatus(
  id: string,
  to: PrivacyStatus,
  details: { reason?: string; verificationMethod?: string; note?: string } = {}
) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const req = await loadRequest(id);
  if (!req) return { error: "That request no longer exists." };
  if (!canMove(req.privacy_status, to)) {
    return { error: `A request that is "${STATUS_LABEL[req.privacy_status]}" can't be moved to "${STATUS_LABEL[to]}".` };
  }

  const now = new Date().toISOString();
  const reason = details.reason?.trim();
  const update: Record<string, unknown> = { privacy_status: to };
  if (to === "verifying") {
    update.verified_at = now;
    update.verification_method = details.verificationMethod?.trim() || null;
  }
  if (to === "denied") {
    if (!reason) return { error: "Say why the request is declined — the parent has to be told." };
    update.denial_reason = reason;
    update.completed_at = now;
  }
  if (to === "completed") update.completed_at = now;
  if (to === "appealed") {
    update.appealed_at = now;
    update.appeal_due_at = addDaysTo(now, APPEAL_DAYS);
  }
  if (to === "appeal_granted" || to === "appeal_denied") {
    if (!reason) return { error: "Write down the decision on the appeal — the parent gets it in writing." };
    update.appeal_decision = reason;
  }
  if (details.note?.trim()) update.resolution_note = details.note.trim();

  const supabase = createAdminSupabase();
  const { error } = await supabase.from("inquiries").update(update).eq("id", id);
  if (error) return { error: error.message };

  await audit(supabase, {
    action: "privacy.status",
    entity: "inquiry",
    entityId: id,
    detail: { from: req.privacy_status, to },
  });
  revalidatePath("/compliance");
  return { success: true };
}

/** Use the one 45-day extension the law allows; the parent must be told why. */
export async function extendPrivacyDeadline(id: string, reason: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const req = await loadRequest(id);
  if (!req) return { error: "That request no longer exists." };
  if (req.extended_at) return { error: "This request has already been extended once — that's the most the law allows." };
  if (!["received", "verifying"].includes(req.privacy_status)) return { error: "Only an open request can be extended." };
  if (new Date(req.due_at).getTime() < Date.now()) return { error: "The deadline has passed; it can only be extended before it runs out." };
  if (!reason?.trim()) return { error: "Say why more time is needed — the parent has to be told." };

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("inquiries")
    .update({ extended_at: new Date().toISOString(), extension_reason: reason.trim(), due_at: addDaysTo(req.due_at, EXTENSION_DAYS) })
    .eq("id", id);
  if (error) return { error: error.message };
  await audit(supabase, { action: "privacy.extend", entity: "inquiry", entityId: id });
  revalidatePath("/compliance");
  return { success: true };
}

/** Say which family on file the request is about. */
export async function linkPrivacyFamily(id: string, parentId: string | null) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (parentId && !UUID.test(parentId)) return { error: "Pick a family." };
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("inquiries").update({ parent_id: parentId }).eq("id", id).eq("kind", "privacy_request");
  if (error) return { error: error.message };
  await audit(supabase, { action: "privacy.link_family", entity: "inquiry", entityId: id, detail: { parent_id: parentId } });
  revalidatePath("/compliance");
  return { success: true };
}

/**
 * Everything held about a family, as JSON, to send to the parent who asked.
 * Returns the document; the page offers it as a download.
 */
export async function exportFamilyData(parentId: string, requestId?: string | null) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (!UUID.test(parentId)) return { error: "Pick a family." };
  const user = await currentUser();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("export_family", {
    p_parent_id: parentId,
    p_actor: user ? `admin:${user.email ?? user.id}` : "admin",
    p_actor_id: user?.id ?? null,
  });
  if (error) return { error: error.message };
  await audit(supabase, {
    action: "privacy.export",
    entity: "parent",
    entityId: parentId,
    detail: { request_id: requestId ?? null },
  });
  const stamp = businessToday();
  return { success: true as const, json: JSON.stringify(data, null, 2), filename: `family-data-${stamp}.json` };
}

/**
 * Erase a family on a verified deletion request: names, contacts, dates of
 * birth, medical notes and messages go; amounts and dates on invoices and
 * payments stay for the books. Cannot be undone. `confirm` must be "ERASE".
 */
export async function eraseFamily(parentId: string, requestId: string, confirm: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (confirm !== "ERASE") return { error: 'Type ERASE to confirm. This can’t be undone.' };
  const req = await loadRequest(requestId);
  if (!req) return { error: "Erasing needs the privacy request it answers." };
  if (req.privacy_status !== "verifying" && req.privacy_status !== "appealed") {
    return { error: "Check it's really them first: move the request to “Checking it's them”, then erase." };
  }
  if (!UUID.test(parentId)) return { error: "Pick a family." };

  const user = await currentUser();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("anonymize_family", {
    p_parent_id: parentId,
    p_request_id: requestId,
    p_actor: user ? `admin:${user.email ?? user.id}` : "admin",
    p_actor_id: user?.id ?? null,
  });
  if (error) return { error: error.message };

  await supabase
    .from("inquiries")
    .update({
      parent_id: parentId,
      privacy_status: req.privacy_status === "appealed" ? "appeal_granted" : "completed",
      completed_at: new Date().toISOString(),
      resolution_note: "Family erased; invoice and payment amounts kept for tax records.",
      ...(req.privacy_status === "appealed" ? { appeal_decision: "Family erased on appeal." } : {}),
    })
    .eq("id", requestId);

  revalidatePath("/compliance");
  revalidatePath("/students");
  revalidatePath(familyHref(parentId));
  return { success: true as const, counts: data as Record<string, number> };
}

/** An opt-out request: no more marketing texts or newsletters to this family. */
export async function applyPrivacyOptOut(requestId: string) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const req = await loadRequest(requestId);
  if (!req) return { error: "That request no longer exists." };
  if (!req.parent_id) return { error: "Link the request to a family first." };
  const user = await currentUser();
  const supabase = createAdminSupabase();
  // Newsletters stop.
  const { error } = await supabase.rpc("record_consent", {
    p_kind: "marketing_email",
    p_granted: false,
    p_source: "privacy_request",
    p_parent_id: req.parent_id,
    p_recorded_by: user?.id ?? null,
  });
  if (error) return { error: error.message };
  // Promotional texts stop (their consent is withdrawn), but practice and
  // payment texts about their own child still go — that's not marketing. A
  // STOP is recorded separately, on the family page.
  const { error: smsError } = await supabase.rpc("record_consent", {
    p_kind: "sms_promotional",
    p_granted: false,
    p_source: "privacy_request",
    p_parent_id: req.parent_id,
    p_recorded_by: user?.id ?? null,
  });
  if (smsError) return { error: smsError.message };
  await audit(supabase, { action: "privacy.opt_out", entity: "inquiry", entityId: requestId, detail: { parent_id: req.parent_id } });
  revalidatePath("/compliance");
  revalidatePath(familyHref(req.parent_id));
  return { success: true };
}
