#!/usr/bin/env node
// Cut a release for what just shipped: work out the next version from the
// commits since the last tag, write notes the owner will read (punny title,
// plain words, "Show me" into the tour), tag it, publish a GitHub release, and
// record it in the app. Run by .github/workflows/ship.yml after a deploy
// passes its smoke test. Does nothing when nothing she'd notice changed.
//
//   node scripts/release.mjs            # for real (CI)
//   node scripts/release.mjs --dry-run  # print what it would do

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCommit,
  bumpFor,
  nextVersion,
  latestVersion,
  fixesFrom,
  tourStepIdsFromSource,
  fallbackNotes,
  validateNotes,
  releaseMarkdown,
} from "./release-lib.mjs";

const DRY = process.argv.includes("--dry-run");
const TOUR = "apps/web/src/components/guided-tour.tsx";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sha = process.env.GITHUB_SHA || git("rev-parse", "HEAD");

// What's new since the last release --------------------------------------
const last = latestVersion(git("tag", "--list", "v*").split("\n"));
const range = last ? `v${last}..${sha}` : sha;
const raw = git("log", range, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", ...(last ? [] : ["-n", "15"]));
const commits = raw
  .split("\x1e")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [h, subject, body] = r.split("\x1f");
    return parseCommit({ sha: h, subject, body });
  })
  .filter((c) => !/^chore\(release\)/.test(c.subject));

const bump = last ? bumpFor(commits) : "first";
if (!bump) {
  console.log(`Nothing to release since v${last}.`);
  process.exit(0);
}
const version = last ? nextVersion(last, bump) : "1.0.0";
console.log(`Releasing v${version} (${bump}) — ${commits.length} commits since ${last ? `v${last}` : "the start"}`);

// Tour stops that are new in this release ---------------------------------
const stepsNow = tourStepIdsFromSource(readFileSync(TOUR, "utf8"));
let stepsBefore = [];
if (last) {
  try {
    stepsBefore = tourStepIdsFromSource(git("show", `v${last}:${TOUR}`));
  } catch {}
}
// The first release has nothing to compare with: nothing is "new".
const newSteps = last ? stepsNow.filter((s) => !stepsBefore.includes(s)) : [];

// Notes she'll read ------------------------------------------------------
function askClaude() {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) return null;
  const prompt = `You write the "What's new" notes inside CoachOS, the app a youth sports business owner (called "Boss" in the app) uses to run her programs: schools, students, parents, payments (autopay, Zelle), WhatsApp messages. She is not technical. She sees these notes once, in a small dialog.

Write notes for version ${version} from the commits below.

Rules:
- "title": a short, warm pun on youth sports/coaching/soccer (max 6 words). Make it fit what changed.
- "summary": one friendly sentence, or "" if the notes say it all.
- "notes": only changes she would notice or benefit from, in plain words, each one sentence starting with what she can now do or what's better. Skip tests, CI, refactors, internal tooling. No jargon (no "server action", "migration", "RLS", "API"). Max 6.
- When a note is about something a tour stop shows, set "tourStep" to one of these ids: ${JSON.stringify(stepsNow)}. New stops this release: ${JSON.stringify(newSteps)} — every new stop should be linked from a note. Otherwise omit tourStep.
- If nothing she'd notice changed, "notes": [] and a title about behind-the-scenes tidying.

Reply with only a JSON object: {"title": string, "summary": string, "notes": [{"text": string, "tourStep"?: string}]}

Commits:
${commits.map((c) => `- ${c.type}${c.scope ? `(${c.scope})` : ""}: ${c.subject}${c.body ? `\n  ${c.body.trim().slice(0, 600).replace(/\n/g, "\n  ")}` : ""}`).join("\n")}`;
  try {
    const out = execFileSync(
      "claude",
      ["-p", prompt, "--output-format", "json", "--model", "claude-opus-5-5", "--max-turns", "1"],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const text = JSON.parse(out).result ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return validateNotes(JSON.parse(json), stepsNow);
  } catch (e) {
    console.warn("Claude didn't write the notes; using the plain ones.", e.message?.slice(0, 300));
    return null;
  }
}

const notes = askClaude() ?? fallbackNotes(version, commits, newSteps);
const fixes = fixesFrom(commits);
const markdown = releaseMarkdown(version, notes, commits);
console.log(`\n${markdown}\n\nFixes: ${fixes.join(", ") || "none"}`);
if (DRY) process.exit(0);

// Tag, GitHub release, and the app ---------------------------------------
git("tag", `v${version}`, sha);
git("push", "origin", `v${version}`);

const dir = mkdtempSync(path.join(tmpdir(), "release-"));
writeFileSync(path.join(dir, "notes.md"), markdown);
execFileSync("gh", ["release", "create", `v${version}`, "--title", `v${version} — ${notes.title}`, "--notes-file", path.join(dir, "notes.md"), "--verify-tag"], { stdio: "inherit" });

const res = await fetch(`${process.env.APP_URL}/api/releases`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.RELEASE_SECRET}`, "content-type": "application/json" },
  body: JSON.stringify({
    version,
    title: notes.title,
    summary: notes.summary,
    notes: notes.notes,
    technical: commits.map((c) => `${c.type === "other" ? "" : `${c.type}: `}${c.subject}`),
    sha,
    fixes,
  }),
});
if (!res.ok) {
  console.error(`The app didn't record the release: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`v${version} recorded in the app:`, await res.json());
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`, { flag: "a" });
