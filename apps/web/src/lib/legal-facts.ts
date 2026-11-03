/**
 * Policy facts: the business and legal values the website's policy pages are
 * built from (contract v1.4; tables in 20261007000400).
 *
 * Each fact has at most one published value (what the website shows) and at
 * most one working copy (a draft, "needs research", or in review). These are
 * the pure rules the Policy facts tab shows them with; the database enforces
 * the same ones.
 */

import { addDays } from "@/lib/dates";

export const LEGAL_DOCUMENTS = [
  "privacy",
  "terms",
  "registration_terms",
  "child_safety",
  "accessibility",
  "privacy_choices",
] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

export const DOCUMENT_LABEL: Record<LegalDocument, string> = {
  privacy: "Privacy Policy",
  terms: "Website Terms of Use",
  registration_terms: "Registration Terms",
  child_safety: "Child Safety Policy",
  accessibility: "Accessibility Statement",
  privacy_choices: "Your Privacy Choices",
};

export const DOCUMENT_PATH: Record<LegalDocument, string> = {
  privacy: "/privacy",
  terms: "/terms",
  registration_terms: "/registration-terms",
  child_safety: "/child-safety",
  accessibility: "/accessibility",
  privacy_choices: "/privacy-choices",
};

export const CATEGORY_ORDER = ["Business", "Money", "Day to day", "Safety & licensing", "Retention", "Technical (not editable)"];

export type FactStatus = "draft" | "needs_research" | "in_review" | "published";

export interface FactVersion {
  id: string;
  key: string;
  value: string;
  status: FactStatus;
  verified: boolean;
  research_notes: string | null;
  sources: string[];
  edited_by: string;
  edited_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  published_at: string | null;
  review_due: string | null;
}

export interface LegalFactRow {
  key: string;
  label: string;
  category: string;
  help: string;
  links: { label: string; url: string }[];
  editable: boolean;
  documents: LegalDocument[];
  preview: string | null;
  review_months: number;
  sort_order: number;
}

export interface PolicyFact extends LegalFactRow {
  /** What the website shows now. */
  published: FactVersion | null;
  /** The draft / needs-research / in-review copy, if someone is working on it. */
  working: FactVersion | null;
  /** When a person last confirmed the published value (not a seeded default). */
  lastVerifiedAt: string | null;
  /** Earlier published values, newest first. */
  history: FactVersion[];
}

/** Put a fact's rows and all versions together, as the tab shows them. */
export function assembleFacts(rows: LegalFactRow[], versions: FactVersion[]): PolicyFact[] {
  const byKey = new Map<string, FactVersion[]>();
  for (const v of versions) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  return rows
    .map((row) => {
      const mine = byKey.get(row.key) ?? [];
      const published = mine
        .filter((v) => v.status === "published")
        .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
      const working = mine.find((v) => v.status !== "published") ?? null;
      const lastVerified = published.find((v) => v.verified);
      return {
        ...row,
        published: published[0] ?? null,
        working,
        lastVerifiedAt: lastVerified?.published_at ?? null,
        history: published.slice(1),
      };
    })
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.sort_order - b.sort_order
    );
}

/** The website treats a value starting with `[CONFIRM` as unfilled. */
export function isPlaceholder(value: string | null | undefined): boolean {
  return !value || !value.trim() || /^\s*\[CONFIRM/i.test(value);
}

export type DisplayState = "verified" | "verify" | "needs_research" | "draft" | "in_review" | "read_only";

export const STATE_LABEL: Record<DisplayState, string> = {
  verified: "Verified",
  verify: "Verify",
  needs_research: "Needs research",
  draft: "Draft",
  in_review: "In review",
  read_only: "Set in website code",
};

/** The one chip a fact wears: its working copy's status, else whether the published value has been checked. */
export function displayState(f: PolicyFact): DisplayState {
  if (!f.editable) return "read_only";
  if (f.working) return f.working.status as DisplayState;
  if (!f.published || isPlaceholder(f.published.value)) return "needs_research";
  return f.published.verified ? "verified" : "verify";
}

/** Due for review: the published value's review date is today or within `withinDays`. */
export function isDueForReview(f: PolicyFact, today: string, withinDays = 14): boolean {
  if (!f.editable || !f.published?.review_due) return false;
  return f.published.review_due <= addDays(today, withinDays);
}

export function isVerified(f: PolicyFact): boolean {
  return f.editable && !!f.published && f.published.verified && !isPlaceholder(f.published.value);
}

/** "10 of 33 verified" — editable facts whose published value a person has confirmed. */
export function progress(facts: PolicyFact[]): { verified: number; total: number } {
  const editable = facts.filter((f) => f.editable);
  return { verified: editable.filter(isVerified).length, total: editable.length };
}

export type FactFilter = "all" | "needs_research" | "due" | "drafts" | "in_review";

export function matchesFilter(f: PolicyFact, filter: FactFilter, today: string): boolean {
  const state = displayState(f);
  switch (filter) {
    case "all":
      return true;
    case "needs_research":
      return state === "needs_research";
    case "due":
      return !f.working && (state === "verify" || isDueForReview(f, today));
    case "drafts":
      return state === "draft";
    case "in_review":
      return state === "in_review";
  }
}

/** Did this working copy change what the website says? */
export function changesValue(f: PolicyFact): boolean {
  return !!f.working && f.working.value !== (f.published?.value ?? "");
}

/**
 * Which documents a batch publish gives a new version, and why: every
 * document showing a fact whose in-review value differs from the published
 * one. A fact confirmed unchanged only becomes verified.
 */
export function affectedDocuments(facts: PolicyFact[]): Map<LegalDocument, string[]> {
  const out = new Map<LegalDocument, string[]>();
  for (const f of facts) {
    if (f.working?.status !== "in_review" || !f.editable || !changesValue(f)) continue;
    for (const d of f.documents) out.set(d, [...(out.get(d) ?? []), f.key]);
  }
  return new Map(LEGAL_DOCUMENTS.filter((d) => out.has(d)).map((d) => [d, out.get(d)!]));
}

/**
 * The version a document gets when published on `day` (YYYY-MM-DD), given the
 * versions it already has: `2026-11-02`, then `2026-11-02.2`, `.3`…
 * Mirrors ops.next_legal_document_version().
 */
export function nextDocumentVersion(existing: string[], day: string): string {
  let n = 0;
  for (const v of existing) {
    if (v === day) n = Math.max(n, 1);
    else if (v.startsWith(`${day}.`)) n = Math.max(n, Number(v.slice(day.length + 1)) || 0);
  }
  return n === 0 ? day : `${day}.${n + 1}`;
}

/** The website's sentence with the value in it, split so the value can be highlighted. */
export function renderPreview(template: string | null, value: string): { text: string; fact: boolean }[] {
  const t = template && template.includes("{value}") ? template : "{value}";
  const parts = t.split("{value}");
  const out: { text: string; fact: boolean }[] = [];
  parts.forEach((p, i) => {
    if (p) out.push({ text: p, fact: false });
    if (i < parts.length - 1) out.push({ text: value, fact: true });
  });
  return out;
}

export type DiffPart = { type: "same" | "add" | "del"; text: string };

/**
 * A word-level diff of the published value against the new one, for "what
 * changes on the website". Plain LCS: values are a few sentences at most.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < m) push("del", a[i++]);
  while (j < n) push("add", b[j++]);
  return out;
}

function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/** Source links typed one per line (or separated by spaces/commas). */
export function parseSources(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function invalidSources(sources: string[]): string[] {
  return sources.filter((s) => !/^https?:\/\/\S+$/i.test(s));
}

/** Who did it, from an audit actor like "compliance:sara@example.com". */
export function actorName(actor: string | null | undefined): string {
  if (!actor) return "—";
  if (actor === "system:seed") return "Website seed";
  const i = actor.indexOf(":");
  return i >= 0 ? actor.slice(i + 1) : actor;
}
