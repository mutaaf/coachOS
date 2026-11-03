import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  admin,
  anonOps,
  anonPublic,
  COMPLIANCE_USER,
  ensureComplianceUser,
  ensureOutsider,
  ensureTestUser,
  LOCAL,
  OUTSIDER,
  resetAuditCompliance,
  signedInClient,
  sql,
  TEST_USER,
} from "../helpers/db";

/**
 * Audit & Compliance in the database: policy facts researched by an
 * assistant, published by an admin, read by the website — and every change in
 * the audit log. These run as real signed-in users through the API, so the
 * row-level policies and the functions' own role checks are what's tested.
 */

const today = () => sql<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d`)[0].d;

async function siteFacts(): Promise<Record<string, string>> {
  const { data, error } = await anonPublic.from("site_legal_facts").select("key, value, published_at");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

async function siteDocs(): Promise<Record<string, { version: string; effective_date: string }>> {
  const { data, error } = await anonPublic.from("site_legal_documents").select("document, version, effective_date");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.document, { version: r.version, effective_date: r.effective_date }]));
}

function auditSince(since: string, prefix: string) {
  return sql<{ actor: string; action: string; detail: Record<string, unknown> }>(
    `SELECT actor, action, detail FROM ops.audit_log WHERE at >= '${since}' AND action LIKE '${prefix}%' ORDER BY at`
  );
}

beforeAll(async () => {
  await ensureTestUser();
  await ensureComplianceUser();
  await ensureOutsider();
});
beforeEach(resetAuditCompliance);
afterAll(resetAuditCompliance);

describe("the seed (contract v1.4)", () => {
  it("has every website key, with technical ones read-only", () => {
    const [counts] = sql<{ total: number; editable: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE editable)::int AS editable FROM ops.legal_facts`
    );
    expect(counts).toEqual({ total: 47, editable: 33 });
    const technical = sql<{ key: string }>(`SELECT key FROM ops.legal_facts WHERE NOT editable ORDER BY key`).map((r) => r.key);
    expect(technical).toContain("phoneDisplay");
    expect(technical).toContain("gaMeasurementId");
    expect(technical).not.toContain("refundWindow");
  });

  it("every editable fact says what to research, with authoritative links where they exist", () => {
    const rows = sql<{ key: string; help: string; links: { url: string }[] }>(`SELECT key, help, links FROM ops.legal_facts WHERE editable`);
    for (const r of rows) {
      expect(r.help.length, r.key).toBeGreaterThan(60);
      for (const l of r.links) expect(l.url, r.key).toMatch(/^https:\/\//);
    }
    const linked = Object.fromEntries(rows.map((r) => [r.key, r.links.map((l) => l.url).join(" ")]));
    expect(linked.legalEntityName).toMatch(/sos\.state\.tx\.us/);
    expect(linked.aedAvailability).toMatch(/ED\.38\.htm#38\.017/);
    expect(linked.firstAidCertification).toMatch(/redcross\.org/);
    expect(linked.firstAidCertification).toMatch(/heart\.org/);
    expect(linked.backgroundCheckProvider).toMatch(/SexOffenderRegistry/);
    expect(linked.youthCampLicense).toMatch(/dshs\.texas\.gov/);
    expect(linked["retention.analytics"]).toMatch(/support\.google\.com\/analytics/);
    expect(linked["retention.errorLogs"]).toMatch(/sentry/);
  });

  it("publishes the current values so the live site doesn't change on deploy", async () => {
    const facts = await siteFacts();
    // 33 editable, minus the mailing address that still needs its street number.
    expect(Object.keys(facts)).toHaveLength(32);
    expect(facts.legalEntityName).toBe("Rising Stars LLC");
    expect(facts.venue).toMatch(/Dallas, Tarrant, Collin or Denton County/);
    expect(facts["retention.analytics"]).toBe("14 months (Google Analytics data retention setting)");
    // Unfilled: the website keeps its own placeholder.
    expect(facts.mailingAddress).toBeUndefined();
    // Set in the website's code: the website's value always wins.
    expect(facts.phoneDisplay).toBeUndefined();
    expect(facts.brandName).toBeUndefined();

    const docs = await siteDocs();
    expect(Object.keys(docs).sort()).toEqual(["accessibility", "child_safety", "privacy", "privacy_choices", "registration_terms", "terms"]);
    for (const d of Object.values(docs)) expect(d).toEqual({ version: "2026-10-05", effective_date: "2026-10-05" });
  });

  it("marks owner-confirmed facts verified and website defaults as still to verify", () => {
    const rows = sql<{ key: string; status: string; verified: boolean; due_now: boolean }>(`
      SELECT key, status, verified, review_due <= current_date AS due_now FROM ops.legal_fact_versions`);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.refundWindow).toMatchObject({ status: "published", verified: true, due_now: false });
    expect(by.heatPolicy).toMatchObject({ status: "published", verified: false, due_now: true });
    expect(by.mailingAddress).toMatchObject({ status: "needs_research", verified: false });
    expect(rows.filter((r) => r.verified)).toHaveLength(10);
  });
});

describe("an assistant researches, an admin publishes", () => {
  it("the compliance role saves a draft and sends it for review; the website keeps the published value until then", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const since = new Date().toISOString();

    const draft = await helper.rpc("save_legal_fact", {
      p_key: "heatPolicy",
      p_value: "We check the heat index before every outdoor session and stop at 103°F",
      p_research_notes: "Called coach Ali; UIL guidance says 104°F",
      p_sources: ["https://www.weather.gov/safety/heat-index"],
      p_status: "draft",
    });
    expect(draft.error).toBeNull();
    expect((await siteFacts()).heatPolicy).toMatch(/^We check the heat index before every outdoor session\. At 90°F/);

    const sent = await helper.rpc("save_legal_fact", {
      p_key: "heatPolicy",
      p_value: "We check the heat index before every outdoor session and stop at 103°F",
      p_research_notes: "Called coach Ali; UIL guidance says 104°F",
      p_sources: ["https://www.weather.gov/safety/heat-index"],
      p_status: "in_review",
    });
    expect(sent.error).toBeNull();
    // Still one working copy, now in review, submitted by the helper.
    const working = sql<{ status: string; submitted_by: string; edited_by: string }>(
      `SELECT status, submitted_by, edited_by FROM ops.legal_fact_versions WHERE key = 'heatPolicy' AND status <> 'published'`
    );
    expect(working).toEqual([{ status: "in_review", submitted_by: `compliance:${COMPLIANCE_USER.email}`, edited_by: `compliance:${COMPLIANCE_USER.email}` }]);

    // The helper can't publish — refused by the database, whatever the UI shows.
    const publish = await helper.rpc("publish_legal_facts", { p_keys: null });
    expect(publish.error?.message).toMatch(/Only an admin can publish/);
    expect((await siteFacts()).heatPolicy).not.toMatch(/103°F/);

    // Each step is in the audit log with who, and old → new.
    const log = auditSince(since, "legal.");
    expect(log.map((l) => l.action)).toEqual(["legal.fact.save", "legal.fact.submit"]);
    expect(log[1].actor).toBe(`compliance:${COMPLIANCE_USER.email}`);
    expect(log[1].detail).toMatchObject({ key: "heatPolicy", from_status: "draft", to_status: "in_review" });
    expect(String(log[0].detail.old_value)).toMatch(/At 90°F/);
    expect(String(log[1].detail.new_value)).toMatch(/103°F/);
  });

  it("an admin publishes: the view returns the new value and each of its documents gets a same-day version", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const owner = await signedInClient(TEST_USER);
    const since = new Date().toISOString();
    await helper.rpc("save_legal_fact", { p_key: "lateFee", p_value: "none.", p_status: "in_review" });
    // Confirmed unchanged: verified, but no new document wording.
    const seeded = sql<{ value: string }>(`SELECT value FROM ops.legal_fact_versions WHERE key = 'medicationPolicy'`)[0].value;
    await helper.rpc("save_legal_fact", { p_key: "medicationPolicy", p_value: seeded, p_status: "in_review" });

    const { data, error } = await owner.rpc("publish_legal_facts", { p_keys: null });
    expect(error).toBeNull();
    const day = today();
    const suffix = day === "2026-10-05" ? `${day}.2` : day;
    expect(data).toEqual({
      published: ["lateFee", "medicationPolicy"],
      changed: ["lateFee"],
      documents: [{ document: "registration_terms", version: suffix }],
    });

    expect((await siteFacts()).lateFee).toBe("none.");
    const docs = await siteDocs();
    expect(docs.registration_terms).toEqual({ version: suffix, effective_date: day });
    expect(docs.privacy.version).toBe("2026-10-05");

    const verified = sql<{ key: string; verified: boolean; reviewed_by: string; months: number }>(`
      SELECT key, verified, reviewed_by, (review_due - current_date) / 28 AS months FROM ops.legal_fact_versions
       WHERE key IN ('lateFee', 'medicationPolicy') AND status = 'published' AND reviewed_by <> 'system:seed' ORDER BY key`);
    expect(verified.map((v) => [v.key, v.verified, v.reviewed_by])).toEqual([
      ["lateFee", true, `admin:${TEST_USER.email}`],
      ["medicationPolicy", true, `admin:${TEST_USER.email}`],
    ]);

    // Publishing again the same day bumps the suffix.
    await owner.rpc("save_legal_fact", { p_key: "lateFee", p_value: "none at all.", p_status: "in_review" });
    const again = await owner.rpc("publish_legal_facts", { p_keys: ["lateFee"] });
    const next = day === "2026-10-05" ? `${day}.3` : `${day}.2`;
    expect(again.data.documents).toEqual([{ document: "registration_terms", version: next }]);

    const log = auditSince(since, "legal.");
    expect(log.filter((l) => l.action === "legal.fact.publish").map((l) => l.detail.key)).toEqual(["lateFee", "medicationPolicy", "lateFee"]);
    expect(log.filter((l) => l.action === "legal.document.version").map((l) => l.detail.version)).toEqual([suffix, next]);
    const publishLate = log.find((l) => l.action === "legal.fact.publish" && l.detail.key === "lateFee")!;
    expect(publishLate.detail).toMatchObject({ old_value: expect.stringMatching(/^none\. If an invoice/), new_value: "none." });
  });

  it("a published version is history: it can't be edited, and a fact with several documents versions each", async () => {
    const owner = await signedInClient(TEST_USER);
    await owner.rpc("save_legal_fact", { p_key: "legalEntityName", p_value: "Rising Stars Youth Academy LLC", p_status: "in_review" });
    const { data } = await owner.rpc("publish_legal_facts", { p_keys: ["legalEntityName"] });
    expect(data.documents.map((d: { document: string }) => d.document)).toEqual(["privacy", "registration_terms", "terms"]);
    const update = () =>
      execSync(`psql "${LOCAL.dbUrl}" -X -q -v ON_ERROR_STOP=1`, {
        input: "UPDATE ops.legal_fact_versions SET value = 'x' WHERE key = 'legalEntityName' AND status = 'published';",
        stdio: ["pipe", "pipe", "pipe"],
      });
    expect(update).toThrow(/can't be changed/);
  });

  it("refuses what the website can't take", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ p_key: "phoneDisplay", p_value: "555", p_status: "draft" }, /set in the website's code/],
      [{ p_key: "refundWindow", p_value: "<b>No refunds</b>", p_status: "draft" }, /Plain text only/],
      [{ p_key: "mailingAddress", p_value: "[CONFIRM: street number] Comal Dr", p_status: "in_review" }, /Fill in the value/],
      [{ p_key: "refundWindow", p_value: "ok", p_sources: ["javascript:alert(1)"], p_status: "draft" }, /web addresses/],
      [{ p_key: "refundWindow", p_value: "ok", p_status: "published" }, /draft/],
      [{ p_key: "noSuchFact", p_value: "ok", p_status: "draft" }, /no policy fact/],
    ];
    for (const [args, message] of cases) {
      const { error } = await helper.rpc("save_legal_fact", args);
      expect(error?.message, JSON.stringify(args)).toMatch(message);
    }
  });

  it("a draft can be discarded, leaving the published value", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    await helper.rpc("save_legal_fact", { p_key: "venue", p_value: "Dallas County", p_status: "draft" });
    expect((await helper.rpc("discard_legal_fact_draft", { p_key: "venue" })).error).toBeNull();
    expect(sql(`SELECT 1 FROM ops.legal_fact_versions WHERE key = 'venue' AND status <> 'published'`)).toEqual([]);
    expect((await siteFacts()).venue).toMatch(/Dallas, Tarrant/);
  });

  it("the mailing address goes live once it's filled in and published", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const owner = await signedInClient(TEST_USER);
    await helper.rpc("save_legal_fact", { p_key: "mailingAddress", p_value: "1234 Comal Dr, Irving, TX 75039", p_status: "in_review" });
    await owner.rpc("publish_legal_facts", { p_keys: null });
    expect((await siteFacts()).mailingAddress).toBe("1234 Comal Dr, Irving, TX 75039");
    expect((await siteDocs()).terms.version).not.toBe("2026-10-05");
  });

  it("nothing in review: nothing to publish", async () => {
    const owner = await signedInClient(TEST_USER);
    const { error } = await owner.rpc("publish_legal_facts", { p_keys: null });
    expect(error?.message).toMatch(/Nothing is waiting/);
  });
});

describe("who can see what", () => {
  it("someone without a role can't read or change policy facts", async () => {
    const outsider = await signedInClient(OUTSIDER);
    expect((await outsider.from("legal_facts").select("key")).data ?? []).toEqual([]);
    expect((await outsider.from("legal_fact_versions").select("id")).data ?? []).toEqual([]);
    expect((await outsider.from("compliance_tasks").select("id")).data ?? []).toEqual([]);
    const { error } = await outsider.rpc("save_legal_fact", { p_key: "venue", p_value: "x", p_status: "draft" });
    expect(error?.message).toMatch(/Only CoachOS staff/);
  });

  it("anon reads the two website views and nothing behind them", async () => {
    expect((await anonPublic.from("site_legal_facts").select("key")).data?.length).toBe(32);
    expect((await anonPublic.from("site_legal_documents").select("document")).data?.length).toBe(6);
    const { data, error } = await anonOps.from("legal_fact_versions").select("research_notes");
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it("nobody writes the tables directly, not even an admin — only through the functions", async () => {
    const owner = await signedInClient(TEST_USER);
    const { error } = await owner.from("legal_fact_versions").insert({ key: "venue", value: "x", status: "published", published_at: new Date().toISOString(), edited_by: "me" });
    expect(error).not.toBeNull();
    const { error: e2 } = await owner.from("legal_document_versions").insert({ document: "terms", version: "2099-01-01", effective_date: "2099-01-01", published_by: "me" });
    expect(e2).not.toBeNull();
  });

  it("the compliance role reads policy and checklist history in the audit log, nothing else there", async () => {
    // Something only an admin may see.
    await admin.from("audit_log").insert({ actor: "admin:boss@example.test", action: "medical.view", entity: "students", detail: { surface: "test" } });
    const helper = await signedInClient(COMPLIANCE_USER);
    await helper.rpc("save_legal_fact", { p_key: "venue", p_value: "Dallas County", p_status: "draft" });
    const { data } = await helper.from("audit_log").select("action").order("at", { ascending: false }).limit(500);
    const actions = (data ?? []).map((r) => r.action);
    expect(actions).toContain("legal.fact.save");
    expect(actions.every((a) => a.startsWith("legal.") || a.startsWith("checklist."))).toBe(true);

    const owner = await signedInClient(TEST_USER);
    const { data: all } = await owner.from("audit_log").select("action").eq("action", "medical.view").limit(1);
    expect(all?.length).toBe(1);
  });
});

describe("the checklist", () => {
  async function task(slug: string) {
    const { data } = await admin.from("compliance_tasks").select("*").eq("slug", slug).single();
    return data!;
  }

  it("is seeded with the recurring checks", () => {
    const slugs = sql<{ slug: string }>(`SELECT slug FROM ops.compliance_tasks ORDER BY sort_order`).map((r) => r.slug);
    expect(slugs).toEqual([
      "attorney-review",
      "insurance-renewal",
      "ga4-settings",
      "texas-no-call",
      "assumed-name-certificate",
      "coach-clearance-review",
      "privacy-requests-due",
      "breach-drill",
    ]);
  });

  it("marking done rolls the due date on the task's cadence and logs it", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const since = new Date().toISOString();
    const t = await task("texas-no-call");
    const { data: next, error } = await helper.rpc("complete_compliance_task", {
      p_task_id: t.id,
      p_done_on: today(),
      p_notes: "Downloaded Q4 list; 0 promotional numbers on it",
      p_evidence_url: "https://drive.example.com/no-call-q4",
    });
    expect(error).toBeNull();
    const [{ expected }] = sql<{ expected: string }>(`SELECT to_char(DATE '${t.next_due}' + interval '3 months', 'YYYY-MM-DD') AS expected`);
    expect(next).toBe(expected);
    expect((await task("texas-no-call")).next_due).toBe(expected);
    const log = auditSince(since, "checklist.");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "checklist.complete", actor: `compliance:${COMPLIANCE_USER.email}` });
    expect(log[0].detail).toMatchObject({ task: "texas-no-call", old_due: t.next_due, new_due: expected, evidence: true });
  });

  it("insurance keeps its policy details private and comes due 30 days before the recorded expiry", async () => {
    const owner = await signedInClient(TEST_USER);
    const t = await task("insurance-renewal");
    const { data: next } = await owner.rpc("complete_compliance_task", {
      p_task_id: t.id,
      p_record: { carrier: "Acme Mutual", policy_number: "GL-123", expires_on: "2027-12-31", stray: "dropped" },
    });
    expect(next).toBe("2027-12-01");
    const after = await task("insurance-renewal");
    expect(after.private_record).toEqual({ carrier: "Acme Mutual", policy_number: "GL-123", expires_on: "2027-12-31" });
    // The log says what was recorded, not the policy number.
    const [entry] = sql<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM ops.audit_log WHERE action = 'checklist.complete' AND detail->>'task' = 'insurance-renewal' ORDER BY at DESC LIMIT 1`
    );
    expect(JSON.stringify(entry.detail)).not.toMatch(/GL-123/);
    // Nothing public carries it.
    const views = sql<{ def: string }>(`SELECT string_agg(pg_get_viewdef(c.oid), ' ') AS def FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v'`);
    expect(views[0].def).not.toMatch(/compliance_task/);
  });

  it("a late check rolls past today; the future and bad links are refused", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const [{ d }] = sql<{ d: string }>(`SELECT ops.compliance_next_due(DATE '2026-01-01', interval '1 month', DATE '2026-03-15')::text AS d`);
    expect(d).toBe("2026-04-01");
    const t = await task("ga4-settings");
    const future = await helper.rpc("complete_compliance_task", { p_task_id: t.id, p_done_on: "2099-01-01" });
    expect(future.error?.message).toMatch(/future/);
    const bad = await helper.rpc("complete_compliance_task", { p_task_id: t.id, p_evidence_url: "file:///etc/passwd" });
    expect(bad.error?.message).toMatch(/evidence link/);
  });

  it("the owner and due date can be changed, and that is logged old → new", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const t = await task("breach-drill");
    const { error } = await helper.rpc("update_compliance_task", { p_task_id: t.id, p_owner: "Sara", p_next_due: "2027-01-15" });
    expect(error).toBeNull();
    expect(await task("breach-drill")).toMatchObject({ owner: "Sara", next_due: "2027-01-15" });
    const [entry] = sql<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM ops.audit_log WHERE action = 'checklist.update' ORDER BY at DESC LIMIT 1`
    );
    expect(entry.detail).toMatchObject({ old_owner: "Owner", new_owner: "Sara", old_due: t.next_due, new_due: "2027-01-15" });
  });
});
