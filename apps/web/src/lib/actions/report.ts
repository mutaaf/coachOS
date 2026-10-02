"use server";

import { currentUser, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { listReleases } from "@/lib/releases";
import { redactForPublic } from "@/lib/redact";

/**
 * "Report a problem". Saved in CoachOS first, so nothing is lost; then, when a
 * GitHub token is configured, filed as an issue for the agents to fix — with
 * family names and numbers taken out, because the repository is public.
 */
export async function reportProblem(message: string, page: string) {
  const user = await currentUser();
  if (!user) return NOT_SIGNED_IN;
  const text = String(message ?? "").trim().slice(0, 5000);
  if (!text) return { error: "Say what happened." };

  const supabase = createAdminSupabase();
  const version = (await listReleases(supabase, 1))[0]?.version ?? null;
  const { data: report, error } = await supabase
    .from("problem_reports")
    .insert({ message: text, page: String(page ?? "").slice(0, 300), version, reported_by: user.email })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const token = process.env.GITHUB_ISSUES_TOKEN;
  const repo = process.env.GITHUB_REPO || "mutaaf/coachOS";
  if (!token) return { success: true as const, filed: false };

  const safe = await redactForPublic(supabase, text);
  const firstLine = safe.split("\n")[0].slice(0, 80);
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: `Boss report: ${firstLine}`,
      labels: ["from-boss", "agent"],
      body: [
        "Reported from inside CoachOS. Names, phone numbers and emails are removed; the full report is in `ops.problem_reports`.",
        "",
        "> " + safe.replace(/\n/g, "\n> "),
        "",
        `- Page: \`${String(page ?? "").replace(/[0-9a-f-]{36}/gi, "{id}").replace(/\/pay\/[\w-]+/, "/pay/{token}")}\``,
        `- Version: ${version ?? "unreleased"}`,
        `- Report: \`${report.id}\``,
      ].join("\n"),
    }),
  }).catch(() => null);

  if (!res?.ok) return { success: true as const, filed: false };
  const issue = await res.json();
  await supabase
    .from("problem_reports")
    .update({ status: "sent", issue_number: issue.number, issue_url: issue.html_url })
    .eq("id", report.id);
  return { success: true as const, filed: true };
}

export async function myReports() {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await createAdminSupabase()
    .from("problem_reports")
    .select("id, created_at, message, status, fixed_in")
    .order("created_at", { ascending: false })
    .limit(20);
  return data || [];
}
