import type { createAdminSupabase } from "@/lib/supabase/server";

/** A client scoped to the `ops` schema, as every operational query uses. */
export type OpsClient = ReturnType<typeof createAdminSupabase>;
