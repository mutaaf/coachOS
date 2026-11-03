/**
 * The compliance checklist (20261007000430): recurring tasks with an owner,
 * a due date and a cadence. The database rolls the due date when a task is
 * marked done; these helpers describe it on screen.
 */

export interface ChecklistField {
  key: string;
  label: string;
  type: "text" | "date";
}

export interface ChecklistCompletion {
  id: string;
  task_id: string;
  done_on: string;
  was_due: string;
  next_due: string;
  notes: string | null;
  evidence_url: string | null;
  record: Record<string, string>;
  done_by: string;
  created_at: string;
}

export interface ChecklistTask {
  id: string;
  slug: string;
  title: string;
  description: string;
  links: { label: string; url: string }[];
  owner: string;
  /** Postgres interval text: "1 year", "3 mons", "7 days". */
  cadence: string;
  next_due: string;
  record_fields: ChecklistField[];
  private_record: Record<string, string>;
  active: boolean;
  sort_order: number;
  completions: ChecklistCompletion[];
}

export type DueState = "overdue" | "soon" | "ok";

/** Overdue, due within two weeks, or fine. */
export function dueState(nextDue: string, today: string): { state: DueState; days: number } {
  const days = Math.round((Date.parse(`${nextDue}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "overdue" : days <= 14 ? "soon" : "ok", days };
}

/** "Every year", "Every 3 months", "Every week" from a Postgres interval. */
export function cadenceLabel(cadence: string): string {
  const c = cadence.trim();
  if (/^1 (year|yr)s?$/.test(c)) return "Every year";
  if (/^1 (mon|month)s?$/.test(c)) return "Every month";
  if (/^7 days?$/.test(c)) return "Every week";
  const m = c.match(/^(\d+) (year|yr|mon|month|day)s?$/);
  if (m) {
    const unit = m[2].startsWith("y") ? "years" : m[2].startsWith("m") ? "months" : "days";
    return `Every ${m[1]} ${unit}`;
  }
  return `Every ${c}`;
}

/** Internal CoachOS links open in place; everything else in a new tab. */
export function isInternalLink(url: string): boolean {
  return url.startsWith("/");
}
