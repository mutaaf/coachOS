import type { OpsClient } from "@/lib/supabase/types";

/**
 * How long personal data is kept, and the job that enforces it
 * (ops.run_retention, 20261006000170). Change a period here; the database
 * applies whatever it is given. docs/COMPLIANCE.md explains each one.
 *
 * Never touched by this job: invoices and payments (IRS: keep at least 3
 * years, 4 for employment taxes, 7 to be safe), incident reports (a child's
 * claim can be brought until they turn 20), and the audit and consent logs.
 */
export const RETENTION = {
  /** Website questions that went nowhere, or anywhere: contact details removed. */
  inquiryMonths: 24,
  /** Declined, cancelled, or never-cleared waitlist registrations. */
  registrationMonths: 24,
  /** A child's medical note, once they have had no active place this long. */
  medicalNoteMonths: 12,
  /** A closed privacy request keeps its record; the requester's contact goes. */
  privacyRequestMonths: 36,
} as const;

export type RetentionPeriods = { -readonly [K in keyof typeof RETENTION]: number };

export interface RetentionResult {
  dry_run: boolean;
  inquiries: number;
  privacy_requests: number;
  registrations: number;
  medical_notes: number;
  periods_months: Record<string, number>;
}

/**
 * Run the retention job. Dry run counts what would be removed and removes
 * nothing; either way an audit row records the counts.
 *
 * Dry run is the default until RETENTION_ENABLED=true is set on Vercel, so the
 * owner sees the first counts before anything is erased.
 */
export async function runRetention(
  supabase: OpsClient,
  opts: { dryRun: boolean; periods?: Partial<RetentionPeriods>; now?: Date }
): Promise<RetentionResult> {
  const p = { ...RETENTION, ...opts.periods };
  const { data, error } = await supabase.rpc("run_retention", {
    p_dry_run: opts.dryRun,
    p_inquiry_months: p.inquiryMonths,
    p_registration_months: p.registrationMonths,
    p_medical_months: p.medicalNoteMonths,
    p_privacy_request_months: p.privacyRequestMonths,
    p_now: (opts.now ?? new Date()).toISOString(),
  });
  if (error) throw new Error(`Retention job failed: ${error.message}`);
  return data as RetentionResult;
}

/** Whether the scheduled run should actually erase, or only count. */
export function retentionDryRun(env: Record<string, string | undefined> = process.env, override?: string | null): boolean {
  if (override === "1" || override === "true") return true;
  return env.RETENTION_ENABLED !== "true";
}
