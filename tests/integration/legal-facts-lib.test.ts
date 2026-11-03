import { describe, it, expect } from "vitest";
import {
  affectedDocuments,
  assembleFacts,
  changesValue,
  diffWords,
  displayState,
  isDueForReview,
  matchesFilter,
  nextDocumentVersion,
  parseSources,
  invalidSources,
  progress,
  renderPreview,
  actorName,
  type FactVersion,
  type LegalFactRow,
} from "@/lib/legal-facts";
import { cadenceLabel, dueState } from "@/lib/compliance-checklist";

/** The Policy facts tab's rules, without a database. */

const row = (key: string, extra: Partial<LegalFactRow> = {}): LegalFactRow => ({
  key,
  label: key,
  category: "Money",
  help: "",
  links: [],
  editable: true,
  documents: ["registration_terms"],
  preview: "Late fee: {value}",
  review_months: 12,
  sort_order: 0,
  ...extra,
});

let n = 0;
const version = (key: string, extra: Partial<FactVersion>): FactVersion => ({
  id: String(++n),
  key,
  value: "v",
  status: "published",
  verified: true,
  research_notes: null,
  sources: [],
  edited_by: "system:seed",
  edited_at: "2026-10-05T12:00:00Z",
  submitted_by: null,
  submitted_at: null,
  reviewed_by: "system:seed",
  published_at: "2026-10-05T12:00:00Z",
  review_due: "2027-10-05",
  ...extra,
});

describe("facts and their state", () => {
  const facts = assembleFacts(
    [
      row("a"),
      row("b"),
      row("c"),
      row("d", { documents: ["privacy", "terms"] }),
      row("e"),
      row("tech", { editable: false, category: "Technical (not editable)" }),
    ],
    [
      version("a", { value: "old", published_at: "2026-01-01T00:00:00Z" }),
      version("a", { value: "new", published_at: "2026-10-05T00:00:00Z" }),
      version("b", { verified: false, review_due: "2026-10-05" }),
      version("c", { status: "needs_research", value: "[CONFIRM: street]", published_at: null, verified: false, review_due: null }),
      version("d", { value: "same" }),
      version("d", { status: "in_review", value: "changed", published_at: null }),
      version("e", { value: "keep" }),
      version("e", { status: "in_review", value: "keep", published_at: null }),
      version("tech", { verified: false, review_due: null }),
    ]
  );
  const by = Object.fromEntries(facts.map((f) => [f.key, f]));

  it("takes the newest published value and keeps the rest as history", () => {
    expect(by.a.published?.value).toBe("new");
    expect(by.a.history.map((h) => h.value)).toEqual(["old"]);
  });

  it("wears one chip each", () => {
    expect(displayState(by.a)).toBe("verified");
    expect(displayState(by.b)).toBe("verify");
    expect(displayState(by.c)).toBe("needs_research");
    expect(displayState(by.d)).toBe("in_review");
    expect(displayState(by.tech)).toBe("read_only");
  });

  it("counts progress over editable facts only", () => {
    // a, d and e are verified; b isn't yet; c has no value.
    expect(progress(facts)).toEqual({ verified: 3, total: 5 });
  });

  it("filters", () => {
    const keys = (f: Parameters<typeof matchesFilter>[1]) => facts.filter((x) => x.editable && matchesFilter(x, f, "2026-10-05")).map((x) => x.key);
    expect(keys("needs_research")).toEqual(["c"]);
    expect(keys("due")).toEqual(["b"]);
    expect(keys("in_review")).toEqual(["d", "e"]);
    expect(isDueForReview(by.a, "2027-09-25")).toBe(true);
    expect(isDueForReview(by.a, "2027-09-01")).toBe(false);
  });

  it("only a changed value versions its documents; a confirmation doesn't", () => {
    expect(changesValue(by.d)).toBe(true);
    expect(changesValue(by.e)).toBe(false);
    expect([...affectedDocuments(facts).entries()]).toEqual([
      ["privacy", ["d"]],
      ["terms", ["d"]],
    ]);
  });
});

describe("document versions", () => {
  it("are the date, then .2, .3 the same day — like the database", () => {
    expect(nextDocumentVersion([], "2026-11-02")).toBe("2026-11-02");
    expect(nextDocumentVersion(["2026-10-05"], "2026-11-02")).toBe("2026-11-02");
    expect(nextDocumentVersion(["2026-11-02"], "2026-11-02")).toBe("2026-11-02.2");
    expect(nextDocumentVersion(["2026-11-02", "2026-11-02.2"], "2026-11-02")).toBe("2026-11-02.3");
    expect(nextDocumentVersion(["2026-11-02.9", "2026-11-02.10", "2026-11-02"], "2026-11-02")).toBe("2026-11-02.11");
  });
});

describe("what the website will say", () => {
  it("puts the value into its sentence", () => {
    expect(renderPreview("Late fee: {value}", "none.")).toEqual([
      { text: "Late fee: ", fact: false },
      { text: "none.", fact: true },
    ]);
    expect(renderPreview(null, "x")).toEqual([{ text: "x", fact: true }]);
  });

  it("diffs word by word", () => {
    expect(diffWords("We stop at 105°F today", "We stop at 103°F today")).toEqual([
      { type: "same", text: "We stop at " },
      { type: "del", text: "105°F" },
      { type: "add", text: "103°F" },
      { type: "same", text: " today" },
    ]);
    expect(diffWords("", "new")).toEqual([{ type: "add", text: "new" }]);
  });

  it("takes source links one per line and flags anything that isn't a web address", () => {
    const s = parseSources("https://a.example\n\n  https://b.example, javascript:alert(1)");
    expect(s).toEqual(["https://a.example", "https://b.example", "javascript:alert(1)"]);
    expect(invalidSources(s)).toEqual(["javascript:alert(1)"]);
  });

  it("names who did it", () => {
    expect(actorName("compliance:sara@example.com")).toBe("sara@example.com");
    expect(actorName("system:seed")).toBe("Website seed");
  });
});

describe("the checklist", () => {
  it("says when things are due", () => {
    expect(dueState("2026-10-04", "2026-10-05")).toEqual({ state: "overdue", days: -1 });
    expect(dueState("2026-10-19", "2026-10-05")).toEqual({ state: "soon", days: 14 });
    expect(dueState("2026-11-04", "2026-10-05")).toEqual({ state: "ok", days: 30 });
  });

  it("reads Postgres intervals as people say them", () => {
    expect(cadenceLabel("1 year")).toBe("Every year");
    expect(cadenceLabel("3 mons")).toBe("Every 3 months");
    expect(cadenceLabel("1 mon")).toBe("Every month");
    expect(cadenceLabel("7 days")).toBe("Every week");
  });
});
