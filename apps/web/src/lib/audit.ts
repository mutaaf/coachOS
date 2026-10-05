import { currentUser } from "@/lib/auth-guard";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Writing to ops.audit_log (20261006000110), the append-only trail of who
 * looked at or changed the records that have to be provable later.
 *
 * Details are ids, counts and reasons — never names, contacts or notes — so
 * the trail can outlive a family's erasure without keeping what was erased.
 * A failed audit write is logged and swallowed: it must never stop a coach
 * seeing an allergy or the Boss answering a parent.
 */

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(supabase: OpsClient, entry: AuditEntry): Promise<void> {
  try {
    const user = await currentUser().catch(() => null);
    const { error } = await supabase.from("audit_log").insert({
      actor: user ? `admin:${user.email ?? user.id}` : "system",
      actor_id: user?.id ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      detail: entry.detail ?? null,
    });
    if (error) console.error("Audit write failed", entry.action, error.message);
  } catch (err) {
    console.error("Audit write failed", entry.action, err);
  }
}

/**
 * A page showed children's medical notes. One row per page view, naming the
 * children whose notes were on it; nothing is written when none were.
 */
export async function logMedicalView(
  supabase: OpsClient,
  surface: string,
  rows: { id: string; medical_notes?: string | null }[],
  entity: "students" | "registrations" = "students"
): Promise<void> {
  const ids = [...new Set(rows.filter((c) => c.medical_notes && c.medical_notes.trim()).map((c) => c.id))];
  if (ids.length === 0) return;
  await audit(supabase, {
    action: "medical.view",
    entity,
    detail: { surface, [entity === "students" ? "student_ids" : "registration_ids"]: ids },
  });
}
