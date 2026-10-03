/**
 * Who may use CoachOS: accounts with the admin role in app_metadata.
 *
 * Being signed in is not enough. Accounts live in a Supabase project shared
 * with the marketing site, so "has an account" says nothing about being the
 * owner. app_metadata can only be set with the service role — a user can
 * change their own user_metadata, never this.
 *
 * The database checks the same thing (ops.is_admin(), public.is_admin()).
 */
export function isAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}
