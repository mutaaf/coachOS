import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { admin } from "../helpers/db";
import { saveTestResult } from "@/lib/actions/help";
import cases from "@/lib/help/acceptance-cases.json";
import { TASKS, PRACTICE } from "@/lib/help/content";

/**
 * Help → Test plan records audit results. Like every action, it is callable
 * by anyone who has its id, so it must refuse anyone not signed in.
 */
describe("recording test results", () => {
  it("refuses anyone who isn't signed in, and records nothing", async () => {
    (globalThis as any).__signedOut = true;
    const id = (cases as { id: string }[])[0].id;
    expect(await saveTestResult(id, { status: "pass" })).toHaveProperty("error");
    const { data } = await admin.from("acceptance_results").select("case_id").eq("case_id", id);
    expect(data).toEqual([]);
  });
});

describe("the test plan and guides", () => {
  it("has unique case ids, each with steps and something to check", () => {
    const list = cases as { id: string; steps: string[]; expected: string[]; severity: string }[];
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    for (const c of list) {
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      expect(c.expected.length, c.id).toBeGreaterThan(0);
      expect(["critical", "high", "medium"]).toContain(c.severity);
    }
  });

  it("links every guide to a real page", () => {
    const pages = readdirSync(new URL("../../apps/web/src/app/(dashboard)", import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const t of TASKS) expect(pages, t.id).toContain(t.href.split(/[/?]/)[1]);
    expect(new Set([...TASKS, ...PRACTICE].map((t) => t.id)).size).toBe(TASKS.length + PRACTICE.length);
  });
});

describe("Show me", () => {
  it("only points at tour steps that exist", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../apps/web/src/components/guided-tour.tsx", import.meta.url), "utf8")
    );
    const ids = new Set([...src.matchAll(/^    id: "([^"]+)"/gm)].map((m) => m[1]));
    for (const t of TASKS) if (t.tourStep) expect(ids.has(t.tourStep), `${t.id} → ${t.tourStep}`).toBe(true);
  });
});
