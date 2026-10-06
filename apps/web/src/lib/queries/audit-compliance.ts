import { createServerSupabase } from "@/lib/supabase/server";
import { assembleFacts, type FactVersion, type LegalFactRow, type PolicyFact } from "@/lib/legal-facts";
import { addDays, businessInstant } from "@/lib/dates";
import { AUDIT_KINDS, type AuditEntry, type AuditFilters, type AuditKind } from "@/lib/audit-kinds";
import type { ChecklistCompletion, ChecklistTask } from "@/lib/compliance-checklist";

/**
 * Reads for Audit & Compliance's policy facts, checklist and audit log.
 *
 * These go through the signed-in person's own session, not the service role,
 * so the database's policies decide what comes back: an admin sees the whole
 * audit log, the compliance role only policy-fact and checklist history, and
 * anyone else nothing at all.
 */

export interface PolicyFactsData {
  facts: PolicyFact[];
  /** Every document version, newest first. */
  documents: { document: string; version: string; effective_date: string; fact_keys: string[]; published_by: string; created_at: string }[];
}

export async function getPolicyFacts(): Promise<PolicyFactsData> {
  const supabase = createServerSupabase();
  const [facts, versions, documents] = await Promise.all([
    supabase.from("legal_facts").select("key, label, category, help, links, editable, documents, preview, review_months, sort_order"),
    supabase
      .from("legal_fact_versions")
      .select("id, key, value, status, verified, research_notes, sources, edited_by, edited_at, submitted_by, submitted_at, reviewed_by, published_at, review_due")
      .order("edited_at", { ascending: false }),
    supabase
      .from("legal_document_versions")
      .select("document, version, effective_date, fact_keys, published_by, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (facts.error) throw facts.error;
  if (versions.error) throw versions.error;
  if (documents.error) throw documents.error;
  return {
    facts: assembleFacts((facts.data ?? []) as LegalFactRow[], (versions.data ?? []) as FactVersion[]),
    documents: documents.data ?? [],
  };
}

export async function getChecklist(): Promise<ChecklistTask[]> {
  const supabase = createServerSupabase();
  const [tasks, completions] = await Promise.all([
    supabase.from("compliance_tasks").select("*").eq("active", true).order("sort_order"),
    supabase.from("compliance_task_completions").select("*").order("done_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
  ]);
  if (tasks.error) throw tasks.error;
  if (completions.error) throw completions.error;
  const byTask = new Map<string, ChecklistCompletion[]>();
  for (const c of (completions.data ?? []) as ChecklistCompletion[]) byTask.set(c.task_id, [...(byTask.get(c.task_id) ?? []), c]);
  return ((tasks.data ?? []) as Omit<ChecklistTask, "completions">[]).map((t) => ({ ...t, completions: byTask.get(t.id) ?? [] }));
}

export { AUDIT_KINDS, type AuditEntry, type AuditFilters, type AuditKind } from "@/lib/audit-kinds";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getAuditLog(filters: AuditFilters = {}): Promise<AuditEntry[]> {
  let q = createServerSupabase()
    .from("audit_log")
    .select("id, at, actor, action, entity, entity_id, detail")
    .order("at", { ascending: false })
    .limit(300);
  const kind = filters.kind && filters.kind in AUDIT_KINDS ? AUDIT_KINDS[filters.kind as AuditKind] : null;
  if (kind) q = q.or(kind.prefixes.map((p) => `action.like.${p}*`).join(","));
  // Only letters, digits and email punctuation reach the filter.
  const actor = (filters.actor ?? "").replace(/[^A-Za-z0-9@._+-]/g, "").slice(0, 100);
  if (actor) q = q.ilike("actor", `%${actor}%`);
  // Business days (Texas): the log stores UTC instants.
  if (filters.from && DATE.test(filters.from)) q = q.gte("at", businessInstant(filters.from, "00:00").toISOString());
  if (filters.to && DATE.test(filters.to)) q = q.lt("at", businessInstant(addDays(filters.to, 1), "00:00").toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}
