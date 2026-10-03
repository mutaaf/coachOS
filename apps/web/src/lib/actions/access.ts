"use server";

import { revalidatePath } from "next/cache";
import { currentUser, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { appUrl } from "@/lib/app-url";
import { sendStaffEmail } from "@/lib/staff-email";
import { isAdmin } from "@/lib/admin";

/**
 * Who can sign in to CoachOS — managed from Settings, no deploy. Everyone
 * here has the admin role (lib/admin.ts); there are no lesser roles yet.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function everyone() {
  const { data } = await createAdminSupabase().auth.admin.listUsers({ perPage: 1000 });
  return data?.users ?? [];
}

export interface Person {
  id: string;
  email: string;
  name: string | null;
  lastSignIn: string | null;
  invitedAt: string | null;
  you: boolean;
}

export async function listAccess(): Promise<Person[] | null> {
  const me = await currentUser();
  if (!me) return null;
  return (await everyone())
    .filter((u) => isAdmin(u))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: (u.user_metadata?.name as string) ?? null,
      lastSignIn: u.last_sign_in_at ?? null,
      invitedAt: u.invited_at ?? null,
      you: u.id === me.id,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** The link that lets someone set their password and walk in. */
function welcomeLink(tokenHash: string, type: "invite" | "recovery") {
  return `${appUrl()}/welcome?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

/**
 * Give someone access: a new account with the admin role and an invite to set
 * a password, or the role for an account that already exists. Returns the
 * link too, so it can be sent another way if email is slow.
 */
export async function inviteToCoachOS(email: string, name?: string) {
  const me = await currentUser();
  if (!me) return NOT_SIGNED_IN;
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) return { error: "That doesn't look like an email address." };

  const supabase = createAdminSupabase();
  const existing = (await everyone()).find((u) => u.email?.toLowerCase() === address);
  let link: string;
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, { app_metadata: { ...existing.app_metadata, role: "admin" } });
    const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email: address });
    if (error) return { error: error.message };
    link = welcomeLink(data.properties.hashed_token, "recovery");
  } else {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: address,
      options: { data: { name: String(name ?? "").trim() || null } },
    });
    if (error) return { error: error.message };
    await supabase.auth.admin.updateUserById(data.user.id, { app_metadata: { role: "admin" } });
    link = welcomeLink(data.properties.hashed_token, "invite");
  }

  const inviter = me.email ?? "the team";
  const emailed = await sendStaffEmail(supabase, {
    to: address,
    subject: "You're on the team — welcome to CoachOS 🎉",
    heading: "You're on the team! 🎉",
    body: `${inviter} gave you access to CoachOS, where the schools, kids, payments and messages all live. Choose a password and you're in.`,
    button: { href: link, label: "Choose my password" },
    text: `${inviter} gave you access to CoachOS. Choose a password here (works once, for 24 hours): ${link}`,
  });

  revalidatePath("/settings");
  return { success: true as const, emailed, link, existed: !!existing };
}

/** Take someone's access away. Never your own, never the last person's. */
export async function removeAccess(userId: string) {
  const me = await currentUser();
  if (!me) return NOT_SIGNED_IN;
  if (userId === me.id) return { error: "You can't remove your own access — ask someone else with access." };
  const admins = (await everyone()).filter((u) => isAdmin(u));
  const target = admins.find((u) => u.id === userId);
  if (!target) return { error: "That person doesn't have access." };
  if (admins.length <= 1) return { error: "Someone has to keep access." };
  const supabase = createAdminSupabase();
  await supabase.auth.admin.updateUserById(userId, { app_metadata: { ...target.app_metadata, role: null } });
  // Sign them out everywhere, now.
  await supabase.auth.admin.signOut(userId, "global").catch(() => {});
  revalidatePath("/settings");
  return { success: true as const };
}

/**
 * "Forgot your password?" — only people with access get a link, but the
 * answer is the same either way, so it can't be used to find out who does.
 */
export async function requestPasswordLink(email: string) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) return { error: "Enter your email address." };
  const supabase = createAdminSupabase();
  const user = (await everyone()).find((u) => u.email?.toLowerCase() === address);
  if (user && isAdmin(user)) {
    const { data } = await supabase.auth.admin.generateLink({ type: "recovery", email: address });
    if (data?.properties?.hashed_token) {
      const link = welcomeLink(data.properties.hashed_token, "recovery");
      await sendStaffEmail(supabase, {
        to: address,
        subject: "Your CoachOS password link",
        heading: "Let's get you back in ⚽",
        body: "Here's your link to choose a new password.",
        button: { href: link, label: "Choose a new password" },
        text: `Choose a new password here (works once, for 24 hours): ${link}`,
      });
    }
  }
  return { success: true as const };
}
