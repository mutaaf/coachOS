/** Groups of audit-log actions the Audit log tab filters by (ops.audit_log.action prefixes). */
export const AUDIT_KINDS = {
  facts: { label: "Policy facts", prefixes: ["legal."] },
  checklist: { label: "Checklist", prefixes: ["checklist."] },
  privacy: { label: "Privacy requests", prefixes: ["privacy."] },
  medical: { label: "Medical notes viewed", prefixes: ["medical."] },
  incidents: { label: "Incidents", prefixes: ["incident."] },
  retention: { label: "Retention clean-up", prefixes: ["retention."] },
} as const;
export type AuditKind = keyof typeof AUDIT_KINDS;

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
}

export interface AuditFilters {
  kind?: string;
  actor?: string;
  from?: string;
  to?: string;
}
