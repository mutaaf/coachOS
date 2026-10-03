"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { isSender, SENDING_DOMAIN } from "@/lib/email";

/**
 * Settings hold the Stripe keys, the Zelle details parents send money to, and
 * the key that lets a script report payments. Only someone signed in changes
 * them — an action is callable by anyone holding its id, from any page.
 */
export async function updateConfig(key: string, value: string) {
  // The same checks as the Save button, so a bad value can't slip in this way.
  return updateMultipleConfigs([{ key, value }]);
}

/**
 * What a value has to look like to be saved. A typo in an address isn't
 * caught by anything downstream — receipts' replies or Zelle alerts would just
 * go nowhere — so it is caught here. Blank is always allowed.
 */
function invalid(item: { label: string; field_type: string; key: string }, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (item.field_type) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : `${item.label}: "${v}" isn't an email address.`;
    case "phone":
      return v.replace(/\D/g, "").length >= 10 ? null : `${item.label}: a phone number needs at least 10 digits.`;
    case "url":
      return /^https?:\/\//.test(v) ? null : `${item.label}: a link starts with https://`;
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return `${item.label}: enter a number of 0 or more.`;
      if (item.key === "card_fee_percent" && n > 10) return `${item.label}: card networks cap surcharges well below ${n}%.`;
      if (item.key === "payment_due_day" && !(Number.isInteger(n) && n >= 1 && n <= 28)) {
        return `${item.label}: pick a day from 1 to 28, so every month has it.`;
      }
      return null;
    }
    default:
      if (item.key === "email_from" && !isSender(v)) {
        return `${item.label}: write it as a name and then an address at ${SENDING_DOMAIN}, like "Rising Stars <payments@${SENDING_DOMAIN}>". Any other address can't send, and parents would get no emails.`;
      }
      if (item.key === "zelle_recipient") {
        const bad = v
          .split(/\s*(?:,|;|\bor\b)\s*/i)
          .filter(Boolean)
          .find((t) => !(t.includes("@") ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) : t.replace(/\D/g, "").length >= 10));
        return bad ? `${item.label}: "${bad}" isn't a phone number or email address.` : null;
      }
      return null;
  }
}

export async function updateMultipleConfigs(updates: { key: string; value: string }[]) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: items } = await supabase
    .from("config")
    .select("key, label, field_type")
    .in(
      "key",
      updates.map((u) => u.key)
    );
  const byKey = new Map((items || []).map((i) => [i.key, i]));
  const problems = updates
    .map((u) => (byKey.get(u.key) ? invalid(byKey.get(u.key)!, u.value) : null))
    .filter(Boolean);
  if (problems.length) return { error: problems.join(" ") };

  for (const { key, value } of updates) {
    const { error } = await supabase
      .from("config")
      .update({ value: value.trim() })
      .eq("key", key);
    if (error) return { error: error.message };
  }
  // Settings feed every page (the tour, payment pages, emails); refresh them all.
  revalidatePath("/", "layout");
  return { success: true };
}
