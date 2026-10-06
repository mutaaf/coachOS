import type { PrivacyRequestType, PrivacyStatus } from "@/types/database";

/**
 * The rules for a privacy request (a parent asking to see, correct or erase
 * what we hold). Plain module — used by the server actions, the Compliance
 * page and the tests.
 *
 * Deadlines (Texas Data Privacy and Security Act, Bus. & Com. Code ch. 541):
 *   - answer within 45 days of receipt (§541.052(b));
 *   - once, when reasonably necessary, 45 more — telling the parent why
 *     within the first 45 (§541.052(b));
 *   - an appeal is decided within 60 days of receipt (§541.053(b)); a denied
 *     appeal must tell the parent how to complain to the Attorney General.
 */

export const RESPONSE_DAYS = 45;
export const EXTENSION_DAYS = 45;
export const APPEAL_DAYS = 60;
/** Shown amber from here, so there is time to act. */
export const DUE_SOON_DAYS = 10;

export const REQUEST_TYPE_LABEL: Record<PrivacyRequestType, string> = {
  access: "See their data",
  delete: "Delete their data",
  correct: "Correct their data",
  opt_out: "Stop marketing",
  appeal: "Appeal a decision",
};

export const STATUS_LABEL: Record<PrivacyStatus, string> = {
  received: "Received",
  verifying: "Checking it's them",
  completed: "Done",
  denied: "Declined",
  appealed: "Appealed",
  appeal_granted: "Appeal upheld",
  appeal_denied: "Appeal declined",
};

/** Where a request can go next. Done and decided appeals are final. */
export const NEXT_STATUSES: Record<PrivacyStatus, PrivacyStatus[]> = {
  received: ["verifying", "denied"],
  verifying: ["completed", "denied"],
  completed: [],
  denied: ["appealed"],
  appealed: ["appeal_granted", "appeal_denied"],
  appeal_granted: [],
  appeal_denied: [],
};

export function canMove(from: PrivacyStatus, to: PrivacyStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

export function isOpen(status: PrivacyStatus): boolean {
  return status === "received" || status === "verifying" || status === "appealed";
}

const DAY = 86_400_000;

export interface Deadline {
  /** The clock that is running: the answer, or the appeal decision. */
  dueAt: string | null;
  daysLeft: number | null;
  state: "closed" | "ok" | "soon" | "overdue";
}

export function deadline(
  r: { privacy_status: PrivacyStatus; due_at: string | null; appeal_due_at?: string | null },
  now: Date = new Date()
): Deadline {
  if (!isOpen(r.privacy_status)) return { dueAt: null, daysLeft: null, state: "closed" };
  const dueAt = r.privacy_status === "appealed" ? (r.appeal_due_at ?? null) : r.due_at;
  if (!dueAt) return { dueAt: null, daysLeft: null, state: "ok" };
  const daysLeft = Math.ceil((new Date(dueAt).getTime() - now.getTime()) / DAY);
  return { dueAt, daysLeft, state: daysLeft < 0 ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "soon" : "ok" };
}

export function addDaysTo(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY).toISOString();
}
