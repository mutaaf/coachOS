import { addDays } from "@/lib/dates";
import type { Coach } from "@/types/database";

/**
 * Whether a coach is cleared to be alone with children, and what is missing.
 *
 * One rule, used everywhere a coach is shown or assigned: the coaches page,
 * the dashboard, the weekly-slot and practice coach pickers, and the
 * program-creation flow (via getCoachClearance in lib/queries/coach-clearance.ts
 * and <CoachClearanceBadge>). Plain module: safe in client components.
 *
 * Cleared means all four are on file and in date:
 *   - a criminal background check that included the sex-offender registry,
 *     renewed every BACKGROUND_CHECK_VALID_MONTHS (Texas requires annual
 *     checks for youth-camp staff, 25 TAC §265.12; we hold every coach to it);
 *   - abuse-prevention training, valid ABUSE_TRAINING_VALID_MONTHS unless the
 *     certificate says otherwise (Health & Safety Code §141.0095: two years);
 *   - CPR / First Aid, until the certificate's expiry date;
 *   - a signed code of conduct.
 *
 * "Expiring" is cleared today but running out within EXPIRING_SOON_DAYS, so
 * there is time to renew before the coach has to come off the schedule.
 */

export const BACKGROUND_CHECK_VALID_MONTHS = 12;
export const ABUSE_TRAINING_VALID_MONTHS = 24;
export const EXPIRING_SOON_DAYS = 30;

export type ClearanceItemKey = "background_check" | "abuse_training" | "cpr_first_aid" | "code_of_conduct";
export type ClearanceItemState = "ok" | "expiring" | "expired" | "missing";
export type ClearanceStatus = "cleared" | "expiring" | "not_cleared";

export interface ClearanceItem {
  key: ClearanceItemKey;
  label: string;
  state: ClearanceItemState;
  /** When it runs out (YYYY-MM-DD), if it does. */
  expiresOn: string | null;
  /** What to do, in words for the Boss. */
  detail: string;
}

export interface CoachClearance {
  coachId: string;
  status: ClearanceStatus;
  items: ClearanceItem[];
  /** Labels of what is missing or expired: why they aren't cleared. */
  problems: string[];
}

export type ClearanceFields = Pick<
  Coach,
  | "id"
  | "background_check_date"
  | "background_check_sex_offender_registry"
  | "abuse_training_date"
  | "abuse_training_expires_on"
  | "cpr_first_aid_expires_on"
  | "code_of_conduct_signed_on"
>;

/** The columns getCoachClearance and the pickers need. */
export const CLEARANCE_COLUMNS =
  "id, background_check_date, background_check_sex_offender_registry, abuse_training_date, abuse_training_expires_on, cpr_first_aid_expires_on, code_of_conduct_signed_on";

/** YYYY-MM-DD plus whole months, clamped to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dated(expiresOn: string | null, today: string): ClearanceItemState {
  if (!expiresOn) return "missing";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, EXPIRING_SOON_DAYS)) return "expiring";
  return "ok";
}

export function evaluateClearance(coach: ClearanceFields, today: string): CoachClearance {
  const items: ClearanceItem[] = [];

  // Background check: only counts if it included the sex-offender registry.
  {
    const expiresOn = coach.background_check_date
      ? addMonths(coach.background_check_date, BACKGROUND_CHECK_VALID_MONTHS)
      : null;
    let state = dated(expiresOn, today);
    let detail =
      state === "missing"
        ? "No background check on file."
        : state === "expired"
          ? "Background check is over a year old. Run a new one."
          : state === "expiring"
            ? "Background check is due for renewal soon."
            : "Background check on file.";
    if (coach.background_check_date && !coach.background_check_sex_offender_registry) {
      state = "missing";
      detail = "The background check on file didn't include the sex-offender registry.";
    }
    items.push({ key: "background_check", label: "Background check", state, expiresOn, detail });
  }

  {
    const expiresOn =
      coach.abuse_training_expires_on ??
      (coach.abuse_training_date ? addMonths(coach.abuse_training_date, ABUSE_TRAINING_VALID_MONTHS) : null);
    const state = dated(expiresOn, today);
    items.push({
      key: "abuse_training",
      label: "Abuse-prevention training",
      state,
      expiresOn,
      detail:
        state === "missing"
          ? "No abuse-prevention training on file."
          : state === "expired"
            ? "Abuse-prevention training has expired."
            : state === "expiring"
              ? "Abuse-prevention training expires soon."
              : "Abuse-prevention training is current.",
    });
  }

  {
    const expiresOn = coach.cpr_first_aid_expires_on ?? null;
    const state = dated(expiresOn, today);
    items.push({
      key: "cpr_first_aid",
      label: "CPR / First Aid",
      state,
      expiresOn,
      detail:
        state === "missing"
          ? "No CPR / First Aid certificate on file."
          : state === "expired"
            ? "CPR / First Aid has expired."
            : state === "expiring"
              ? "CPR / First Aid expires soon."
              : "CPR / First Aid is current.",
    });
  }

  {
    const state: ClearanceItemState = coach.code_of_conduct_signed_on ? "ok" : "missing";
    items.push({
      key: "code_of_conduct",
      label: "Code of conduct",
      state,
      expiresOn: null,
      detail: state === "ok" ? "Signed." : "Code of conduct not signed.",
    });
  }

  const problems = items.filter((i) => i.state === "missing" || i.state === "expired").map((i) => i.label);
  const status: ClearanceStatus = problems.length
    ? "not_cleared"
    : items.some((i) => i.state === "expiring")
      ? "expiring"
      : "cleared";

  return { coachId: coach.id, status, items, problems };
}

/** Whether they may be put in charge of children today. Expiring still counts. */
export function isCleared(c: Pick<CoachClearance, "status">): boolean {
  return c.status !== "not_cleared";
}
