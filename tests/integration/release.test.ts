import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseCommit,
  bumpFor,
  nextVersion,
  latestVersion,
  fixesFrom,
  tourStepIdsFromSource,
  fallbackNotes,
  fallbackTitle,
  validateNotes,
} from "../../scripts/release-lib.mjs";
import { compareVersions, unseen, recordRelease } from "@/lib/releases";
import { redactText } from "@/lib/redact";
import { admin, truncateAll } from "../helpers/db";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Versions are strict MAJOR.MINOR.PATCH, worked out from conventional commit
 * messages, with notes she'll read. A wrong bump or a broken "Show me" is
 * what this guards against.
 */

const c = (subject: string, body = "") => parseCommit({ sha: "abc1234", subject, body });

describe("the next version", () => {
  it("follows the commits: breaking → major, feat → minor, fix → patch, housekeeping → none", () => {
    expect(bumpFor([c("fix: a"), c("feat(payments): b")])).toBe("minor");
    expect(bumpFor([c("feat!: drop the old flow")])).toBe("major");
    expect(bumpFor([c("fix: x", "BREAKING CHANGE: links change")])).toBe("major");
    expect(bumpFor([c("fix: x"), c("chore: y")])).toBe("patch");
    expect(bumpFor([c("Who paid this? Place a payment")])).toBe("patch");
    expect(bumpFor([c("chore: deps"), c("test: more"), c("ci: faster"), c("docs: readme")])).toBeNull();
  });

  it("is strict MAJOR.MINOR.PATCH", () => {
    expect(nextVersion("1.9.9", "patch")).toBe("1.9.10");
    expect(nextVersion("1.9.9", "minor")).toBe("1.10.0");
    expect(nextVersion("1.9.9", "major")).toBe("2.0.0");
    expect(() => nextVersion("1.2", "patch")).toThrow();
    expect(() => nextVersion("01.2.3", "patch")).toThrow();
    expect(latestVersion(["v1.2.3", "v1.10.0", "v1.9.9", "nightly", "v2.0.0-rc.1", ""])).toBe("1.10.0");
    expect(latestVersion([])).toBeNull();
  });

  it("orders versions by number, not by text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });
});

describe("the notes", () => {
  it("finds the issues a release fixes", () => {
    expect(fixesFrom([c("fix: zelle", "Fixes #12\ncloses #3"), c("feat: x", "Resolves #40. See #99")])).toEqual([3, 12, 40]);
  });

  it("reads the tour's stops from its source", () => {
    const src = readFileSync(path.resolve(__dirname, "../../apps/web/src/components/guided-tour.tsx"), "utf8");
    const ids = tourStepIdsFromSource(src);
    expect(ids).toContain("welcome");
    expect(ids).toContain("record-payment");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps only 'Show me' links to stops that exist", () => {
    const v = validateNotes(
      { title: "Net Gains", summary: "s", notes: [{ text: "A", tourStep: "record-payment" }, { text: "B", tourStep: "nope" }, { text: "" }] },
      ["record-payment"]
    );
    expect(v).toEqual({ title: "Net Gains", summary: "s", notes: [{ text: "A", tourStep: "record-payment" }, { text: "B" }] });
    expect(validateNotes({ notes: [] }, [])).toBeNull();
  });

  it("without the AI, still has a pun and her changes", () => {
    expect(fallbackTitle("1.2.3")).toBe(fallbackTitle("1.2.3"));
    const n = fallbackNotes("1.2.3", [c("feat(payments): record cash from anyone"), c("fix: zelle timer"), c("chore: x")], ["record-payment"]);
    expect(n.notes).toEqual([{ text: "Record cash from anyone", tourStep: "record-payment" }, { text: "Fixed: Zelle timer" }]);
    expect(n.title.length).toBeGreaterThan(3);
    // Two features, two new stops: no guessing which goes with which.
    const two = fallbackNotes("1.3.0", [c("feat: a"), c("feat: b")], ["x", "y"]);
    expect(two.notes.every((x: any) => !x.tourStep)).toBe(true);
  });
});

describe("what's new, in the app", () => {
  const r = (version: string) => ({ version, title: "", summary: "", notes: [], technical: [], released_at: "" });

  it("shows only releases since she last looked — and only the latest the first time", () => {
    const list = [r("1.3.0"), r("1.2.1"), r("1.2.0")];
    expect(unseen(list, "1.2.0").map((x) => x.version)).toEqual(["1.3.0", "1.2.1"]);
    expect(unseen(list, "1.3.0")).toEqual([]);
    expect(unseen(list, undefined).map((x) => x.version)).toEqual(["1.3.0"]);
  });

  it("records a release and marks the problems it fixes as fixed", async () => {
    await truncateAll();
    const db = admin as unknown as OpsClient;
    await admin.from("problem_reports").insert([
      { message: "Record button did nothing", issue_number: 7, status: "sent" },
      { message: "Other", issue_number: 8, status: "sent" },
    ]);
    expect(await recordRelease(db, { version: "1.2", title: "x" })).toHaveProperty("error");
    expect(await recordRelease(db, { version: "1.2.0", title: "Net Gains", notes: [{ text: "A" }], fixes: [7] })).toEqual({
      success: true,
      fixedReports: 1,
    });
    const { data } = await admin.from("problem_reports").select("issue_number, status, fixed_in").order("issue_number");
    expect(data).toEqual([
      { issue_number: 7, status: "fixed", fixed_in: "1.2.0" },
      { issue_number: 8, status: "sent", fixed_in: null },
    ]);
    await truncateAll();
  });
});

describe("reports going to the public repository", () => {
  it("lose families' names, phones, emails and long numbers", () => {
    const out = redactText(
      "Raquel Garcia (214) 555-0101 raquel@example.com paid for Mía and Mia's brother. Card 4242 4242 4242 4242. Invoice $120 for Oct 3.",
      ["Raquel", "Garcia", "Mía"]
    );
    expect(out).toBe("[name] [name] [phone] [email] paid for [name] and [name]'s brother. Card [number]. Invoice $120 for Oct 3.");
  });
});
