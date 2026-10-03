import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

/**
 * Whether the request comes from someone signed in to the dashboard.
 *
 * Server actions are public endpoints to anyone holding their id, whatever
 * page they were written for; middleware guards pages, not actions. An action
 * that writes data or spends money checks this itself.
 */
export async function signedIn(): Promise<boolean> {
  return !!(await currentUser());
}

/** Who is signed in with the admin role, or null. See lib/admin.ts. */
export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const { data } = await createServerSupabase().auth.getUser();
  return isAdmin(data.user) ? { id: data.user!.id, email: data.user!.email ?? null } : null;
}

export const NOT_SIGNED_IN = { error: "Your session has ended. Sign in again and retry." };

/**
 * The same check, for actions that throw rather than return { error }.
 * useAction() shows the message either way.
 */
export async function requireSignedIn(): Promise<void> {
  if (!(await signedIn())) throw new Error(NOT_SIGNED_IN.error);
}
