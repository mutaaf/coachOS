// Pure pieces of the release: no git, no network. Tested in
// tests/integration/release.test.ts; driven by scripts/release.mjs.

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/** "feat(payments)!: who paid this" → { type, scope, breaking, subject } */
export function parseCommit({ sha = "", subject = "", body = "" }) {
  const m = subject.match(CONVENTIONAL);
  const breaking = !!m?.[3] || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    type: m ? m[1].toLowerCase() : "other",
    scope: m?.[2] ?? null,
    breaking,
    subject: (m ? m[4] : subject).trim(),
    body,
  };
}

/** Which part of the version a set of commits moves, or null for no release. */
export function bumpFor(commits) {
  if (commits.some((c) => c.breaking)) return "major";
  if (commits.some((c) => c.type === "feat")) return "minor";
  // Anything that isn't plainly housekeeping changes what she runs.
  const quiet = new Set(["chore", "docs", "test", "ci", "style", "build"]);
  if (commits.some((c) => !quiet.has(c.type))) return "patch";
  return null;
}

export function nextVersion(current, bump) {
  if (!SEMVER.test(current)) throw new Error(`Not a version: ${current}`);
  const [a, b, c] = current.split(".").map(Number);
  if (bump === "major") return `${a + 1}.0.0`;
  if (bump === "minor") return `${a}.${b + 1}.0`;
  if (bump === "patch") return `${a}.${b}.${c + 1}`;
  throw new Error(`Unknown bump: ${bump}`);
}

/** The newest strict vX.Y.Z tag, as X.Y.Z. */
export function latestVersion(tags) {
  const versions = tags.map((t) => t.trim().replace(/^v/, "")).filter((v) => SEMVER.test(v));
  versions.sort((x, y) => {
    const a = x.split(".").map(Number);
    const b = y.split(".").map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
  return versions.at(-1) ?? null;
}

/** Issue numbers closed by "Fixes #12", "closes #3", "Resolves #40". */
export function fixesFrom(commits) {
  const out = new Set();
  for (const c of commits) {
    for (const m of `${c.subject}\n${c.body}`.matchAll(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi)) {
      out.add(Number(m[1]));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The tour's stop ids, read from guided-tour.tsx's source. */
export function tourStepIdsFromSource(source) {
  const body = source.slice(source.indexOf("function buildSteps"));
  return [...body.matchAll(/^\s{4}id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);
}

const PUNS = [
  "Nothing But Net",
  "Swish!",
  "Full-Court Press",
  "A Slam-Dunk Update",
  "Buckets of Fixes",
  "Off the Backboard",
  "Fast Break",
  "Rebound and Ready",
  "Assist Mode: On",
  "Hoop Dreams, Delivered",
  "Courtside Upgrades",
  "Dribble, Drive, Deploy",
  "Alley-Oop Improvements",
  "No Foul Play",
  "Triple-Double Trouble-Free",
  "Shot Clock Beaten",
]

/** A punny title that's the same for the same version, so a re-run doesn't change it. */
export function fallbackTitle(version) {
  let h = 0;
  for (const ch of version) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PUNS[h % PUNS.length];
}

const plain = (s) => s.replace(/`/g, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** Notes without the AI: features and fixes, in her words as far as commit subjects allow. */
export function fallbackNotes(version, commits, newTourSteps = []) {
  // Commits from before conventional messages ("other") read like features.
  const features = commits.filter((c) => c.type === "feat" || c.type === "other");
  const fixes = commits.filter((c) => c.type === "fix");
  // Without the AI there's no telling which stop shows which feature, so only
  // the unambiguous case gets a "Show me": one new feature, one new stop.
  const only = features.length === 1 && newTourSteps.length === 1 ? newTourSteps[0] : null;
  const notes = [
    ...features.map((c) => ({ text: plain(c.subject), ...(only ? { tourStep: only } : {}) })),
    ...fixes.map((c) => ({ text: `Fixed: ${plain(c.subject)}` })),
  ].slice(0, 8);
  return {
    title: fallbackTitle(version),
    summary: notes.length ? "" : "Behind-the-scenes improvements — nothing new to learn.",
    notes,
  };
}

/**
 * Keep what the AI wrote only if it's the right shape, and only "Show me"
 * links to stops that exist.
 */
export function validateNotes(raw, knownSteps) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 80) : "";
  if (!title) return null;
  const known = new Set(knownSteps);
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter((n) => n && typeof n.text === "string" && n.text.trim())
    .slice(0, 8)
    .map((n) => ({
      text: n.text.trim().slice(0, 300),
      ...(typeof n.tourStep === "string" && known.has(n.tourStep) ? { tourStep: n.tourStep } : {}),
    }));
  return { title, summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 400) : "", notes };
}

export function releaseMarkdown(version, notes, commits) {
  const lines = [`## ${notes.title}`, ""];
  if (notes.summary) lines.push(notes.summary, "");
  for (const n of notes.notes) lines.push(`- ${n.text}`);
  lines.push("", "<details><summary>Commits</summary>", "");
  for (const c of commits) lines.push(`- ${c.sha.slice(0, 7)} ${c.type === "other" ? "" : `${c.type}: `}${c.subject}`);
  lines.push("", "</details>");
  return lines.join("\n");
}
