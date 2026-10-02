import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Whether the request comes from someone signed in to the dashboard.
 *
 * Server actions are public endpoints to anyone holding their id, whatever
 * page they were written for; middleware guards pages, not actions. An action
 * that writes data or spends money checks this itself.
 */
export async function signedIn(): Promise<boolean> {
  const { data } = await createServerSupabase().auth.getUser();
  return !!data.user;
}

export const NOT_SIGNED_IN = { error: "Your session has ended. Sign in again and retry." };
