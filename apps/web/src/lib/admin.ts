/**
 * Who may use CoachOS: accounts with a staff role in app_metadata.
 *
 * Being signed in is not enough. Accounts live in a Supabase project shared
 * with the marketing site, so "has an account" says nothing about being the
 * owner. app_metadata can only be set with the service role — a user can
 * change their own user_metadata, never this.
 *
 *   admin       the owner and anyone he trusts with everything
 *   compliance  an assistant who researches policy facts and keeps the
 *               compliance checklist: Audit & Compliance only, never
 *               families, children, medical notes, payments or messages,
 *               and never publishing to the website
 *
 * The database checks the same thing (ops.is_admin(), ops.staff_role()).
 */
export type StaffRole = "admin" | "compliance";

type MaybeUser = { app_metadata?: Record<string, unknown> } | null | undefined;

export function isAdmin(user: MaybeUser): boolean {
  return user?.app_metadata?.role === "admin";
}

export function staffRole(user: MaybeUser): StaffRole | null {
  const role = user?.app_metadata?.role;
  return role === "admin" || role === "compliance" ? role : null;
}

/** Signed in with either staff role. */
export function isStaff(user: MaybeUser): boolean {
  return staffRole(user) !== null;
}

/** Where someone lands after signing in. */
export function homeFor(role: StaffRole | null): string {
  return role === "compliance" ? COMPLIANCE_HOME : "/dashboard";
}

export const COMPLIANCE_HOME = "/compliance";

/**
 * The only pages the compliance role may open. Everything else in the
 * dashboard renders families' details, so middleware sends them back here.
 */
export function complianceMayOpen(pathname: string): boolean {
  return pathname === COMPLIANCE_HOME || pathname.startsWith(`${COMPLIANCE_HOME}/`);
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Admin — everything",
  compliance: "Compliance — Audit & Compliance only",
};
