"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { homeFor, staffRole } from "@/lib/admin";

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = createServerSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }
  const role = staffRole(data.user);
  if (!role) {
    await supabase.auth.signOut();
    return { error: "This account doesn't have access to CoachOS. Ask Mutaaf to give it access." };
  }

  redirect(homeFor(role));
}

export async function signOut() {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
