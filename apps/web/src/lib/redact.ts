import type { OpsClient } from "@/lib/supabase/types";

/**
 * Take families out of text bound for the public GitHub repository: every
 * parent's and child's name, phone numbers, email addresses and long numbers.
 * The full report stays in CoachOS; only this version leaves it.
 */
export async function redactForPublic(supabase: OpsClient, text: string): Promise<string> {
  const [parents, students] = await Promise.all([
    supabase.from("parents").select("first_name, last_name"),
    supabase.from("students").select("first_name, last_name"),
  ]);
  const names = new Set<string>();
  for (const r of [...(parents.data || []), ...(students.data || [])] as any[]) {
    for (const n of [r.first_name, r.last_name]) {
      const t = String(n ?? "").trim();
      if (t.length >= 2) names.add(t);
    }
  }
  return redactText(text, [...names]);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactText(text: string, names: string[]): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b\d(?:[\s-]?\d){12,18}\b/g, "[number]")
    .replace(/\+?\(?\d[\d\s().-]{8,}\d/g, "[phone]");
  // Longest first, so "Mia Garcia" goes before "Mia".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const accentless = name.normalize("NFD").replace(/\p{M}/gu, "");
    for (const form of new Set([name, accentless])) {
      out = out.replace(new RegExp(`(?<![\\p{L}])${escape(form)}(?![\\p{L}])`, "giu"), "[name]");
    }
  }
  return out;
}
