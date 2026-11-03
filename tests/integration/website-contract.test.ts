import { describe, it, expect } from "vitest";
import { sql } from "../helpers/db";

/**
 * The website contract, pinned.
 *
 * risingstars.training reads and writes this database with the anon key, which
 * ships in its JavaScript bundle. Each object below is a door the site codes
 * against (docs/WEBSITE_CONTRACT.md). The views run with owner rights and read
 * `ops`, so a column added to one is public the moment it is applied — this
 * test is what makes adding one a deliberate, reviewed change rather than an
 * accident, and what stops a rename from breaking the live site.
 *
 * Changing an expected list here means changing the contract: tell the
 * website team first.
 */

type Column = { column_name: string; type: string };

function columnsOf(view: string): Column[] {
  return sql<Column>(`
    SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
     WHERE a.attrelid = 'public.${view}'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`);
}

function privileges(signatureOrRelation: string, kind: "function" | "table") {
  const roles = ["anon", "authenticated", "service_role"];
  const check = kind === "function" ? "has_function_privilege" : "has_table_privilege";
  const priv = kind === "function" ? "EXECUTE" : "SELECT";
  const [row] = sql<Record<string, boolean>>(
    `SELECT ${roles.map((r) => `${check}('${r}', '${signatureOrRelation}', '${priv}') AS ${r}`).join(", ")}`
  );
  return row;
}

function functionFacts(signature: string) {
  const [row] = sql<{ security_definer: boolean; config: string[] | null; result: string; public_execute: boolean }>(`
    SELECT p.prosecdef AS security_definer,
           p.proconfig AS config,
           pg_get_function_result(p.oid) AS result,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
      FROM pg_proc p
     WHERE p.oid = '${signature}'::regprocedure`);
  return row;
}

/** Words that would mean a person's details had leaked into a public view. */
const PII = /child|parent|phone|email|medical|student|notes|whatsapp|pay_rate|dob|birth/i;

describe("public.program_availability (deprecated alias, kept until the site migrates)", () => {
  it("has exactly the agreed columns", () => {
    expect(columnsOf("program_availability")).toEqual([
      { column_name: "cms_program_id", type: "uuid" },
      { column_name: "ops_program_id", type: "uuid" },
      { column_name: "title", type: "text" },
      { column_name: "capacity", type: "integer" },
      { column_name: "seats_taken", type: "integer" },
      { column_name: "seats_remaining", type: "integer" },
      { column_name: "registration_open", type: "boolean" },
      { column_name: "monthly_fee", type: "numeric(10,2)" },
      { column_name: "waitlist_count", type: "bigint" },
    ]);
  });

  it("is readable by anon and carries nothing about a person", () => {
    expect(privileges("public.program_availability", "table").anon).toBe(true);
    for (const c of columnsOf("program_availability")) expect(c.column_name).not.toMatch(PII);
  });
});

describe("public.submit_registration (v1)", () => {
  const sig =
    "public.submit_registration(uuid, text, text, text, text, text, text, text, date, text, text)";

  it("keeps its signature, result and owner-rights posture", () => {
    const f = functionFacts(sig);
    expect(f.security_definer).toBe(true);
    expect(f.result).toBe("TABLE(status text, waitlist_position integer, amount numeric)");
  });

  it("is executable by anon and the site's signed-in users, not by PUBLIC", () => {
    expect(privileges(sig, "function")).toMatchObject({ anon: true, authenticated: true });
    expect(functionFacts(sig).public_execute).toBe(false);
  });
});

describe("public.site_offerings", () => {
  it("has exactly the agreed columns, in order", () => {
    expect(columnsOf("site_offerings")).toEqual([
      { column_name: "offering_id", type: "uuid" },
      { column_name: "cms_program_id", type: "uuid" },
      { column_name: "public_slug", type: "text" },
      { column_name: "title", type: "text" },
      { column_name: "description", type: "text" },
      { column_name: "image_url", type: "text" },
      { column_name: "sport", type: "text" },
      { column_name: "age_groups", type: "text[]" },
      { column_name: "season_name", type: "text" },
      { column_name: "start_date", type: "date" },
      { column_name: "end_date", type: "date" },
      { column_name: "monthly_fee", type: "numeric(10,2)" },
      { column_name: "billing_period", type: "text" },
      { column_name: "capacity", type: "integer" },
      { column_name: "seats_remaining", type: "integer" },
      { column_name: "waitlist_count", type: "integer" },
      { column_name: "registration_open", type: "boolean" },
      { column_name: "status", type: "text" },
      { column_name: "venue_name", type: "text" },
      { column_name: "venue_city", type: "text" },
      { column_name: "venue_address", type: "text" },
      { column_name: "schedule", type: "jsonb" },
      { column_name: "featured", type: "boolean" },
      { column_name: "sort_order", type: "integer" },
    ]);
  });

  it("is readable by anon, runs with its owner's rights, and carries nothing about a person", () => {
    expect(privileges("public.site_offerings", "table").anon).toBe(true);
    const [{ invoker }] = sql<{ invoker: boolean }>(`
      SELECT coalesce('security_invoker=true' = ANY (reloptions), false) AS invoker
        FROM pg_class WHERE oid = 'public.site_offerings'::regclass`);
    expect(invoker).toBe(false);
    for (const c of columnsOf("site_offerings")) expect(c.column_name).not.toMatch(PII);
  });
});

describe("public.site_media (v1.2)", () => {
  it("has exactly the agreed columns, in order", () => {
    expect(columnsOf("site_media")).toEqual([
      { column_name: "id", type: "uuid" },
      { column_name: "slot", type: "text" },
      { column_name: "offering_id", type: "uuid" },
      { column_name: "sort_order", type: "integer" },
      { column_name: "alt", type: "text" },
      { column_name: "caption", type: "text" },
      { column_name: "focal_x", type: "numeric" },
      { column_name: "focal_y", type: "numeric" },
      { column_name: "width", type: "integer" },
      { column_name: "height", type: "integer" },
      { column_name: "url", type: "text" },
      { column_name: "srcset", type: "jsonb" },
      { column_name: "updated_at", type: "timestamp with time zone" },
    ]);
  });

  it("is readable by anon, runs with its owner's rights, and never shows who uploaded or the release answers", () => {
    expect(privileges("public.site_media", "table").anon).toBe(true);
    const [{ invoker }] = sql<{ invoker: boolean }>(`
      SELECT coalesce('security_invoker=true' = ANY (reloptions), false) AS invoker
        FROM pg_class WHERE oid = 'public.site_media'::regclass`);
    expect(invoker).toBe(false);
    for (const c of columnsOf("site_media")) {
      expect(c.column_name).not.toMatch(PII);
      expect(c.column_name).not.toMatch(/upload|release|minor|note|published|path|filename/i);
    }
  });

  it("filters on the publish rule in the view itself", () => {
    const [{ def }] = sql<{ def: string }>(`SELECT pg_get_viewdef('public.site_media'::regclass) AS def`);
    expect(def).toMatch(/published/);
    expect(def).toMatch(/contains_identifiable_minors/);
    expect(def).toMatch(/photo_release_confirmed/);
  });
});

describe("public.submit_inquiry", () => {
  const sig = "public.submit_inquiry(text, jsonb, jsonb, jsonb)";

  it("runs as its owner with an empty search_path and returns only an id", () => {
    const f = functionFacts(sig);
    expect(f.security_definer).toBe(true);
    expect(f.config).toContain('search_path=""');
    expect(f.result).toBe("uuid");
  });

  it("is executable by anon, not by PUBLIC", () => {
    expect(privileges(sig, "function").anon).toBe(true);
    expect(functionFacts(sig).public_execute).toBe(false);
  });
});

describe("public.submit_registration_v2", () => {
  const sig = "public.submit_registration_v2(uuid, jsonb, jsonb, jsonb, jsonb, uuid)";

  it("runs as its owner with an empty search_path and returns jsonb", () => {
    const f = functionFacts(sig);
    expect(f.security_definer).toBe(true);
    expect(f.config).toContain('search_path=""');
    expect(f.result).toBe("jsonb");
  });

  it("is executable by anon, not by PUBLIC", () => {
    expect(privileges(sig, "function").anon).toBe(true);
    expect(functionFacts(sig).public_execute).toBe(false);
  });
});

describe("public.site_legal_facts (v1.4)", () => {
  it("has exactly the agreed columns, in order", () => {
    expect(columnsOf("site_legal_facts")).toEqual([
      { column_name: "key", type: "text" },
      { column_name: "value", type: "text" },
      { column_name: "published_at", type: "timestamp with time zone" },
    ]);
  });

  it("is readable by anon, runs with its owner's rights, and never shows notes, sources, drafts or who edited", () => {
    expect(privileges("public.site_legal_facts", "table").anon).toBe(true);
    const [{ invoker }] = sql<{ invoker: boolean }>(`
      SELECT coalesce('security_invoker=true' = ANY (reloptions), false) AS invoker
        FROM pg_class WHERE oid = 'public.site_legal_facts'::regclass`);
    expect(invoker).toBe(false);
    for (const c of columnsOf("site_legal_facts")) {
      expect(c.column_name).not.toMatch(PII);
      expect(c.column_name).not.toMatch(/note|source|status|edit|review|draft|by$/i);
    }
  });

  it("filters to published, website-managed values in the view itself", () => {
    const [{ def }] = sql<{ def: string }>(`SELECT pg_get_viewdef('public.site_legal_facts'::regclass) AS def`);
    expect(def).toMatch(/'published'/);
    expect(def).toMatch(/editable/);
    expect(def).toMatch(/CONFIRM/);
  });
});

describe("public.site_legal_documents (v1.4)", () => {
  it("has exactly the agreed columns, in order", () => {
    expect(columnsOf("site_legal_documents")).toEqual([
      { column_name: "document", type: "text" },
      { column_name: "version", type: "text" },
      { column_name: "effective_date", type: "date" },
    ]);
  });

  it("is readable by anon and runs with its owner's rights", () => {
    expect(privileges("public.site_legal_documents", "table").anon).toBe(true);
    const [{ invoker }] = sql<{ invoker: boolean }>(`
      SELECT coalesce('security_invoker=true' = ANY (reloptions), false) AS invoker
        FROM pg_class WHERE oid = 'public.site_legal_documents'::regclass`);
    expect(invoker).toBe(false);
  });

  it("names only the six agreed documents", () => {
    const docs = sql<{ document: string }>(`SELECT document FROM public.site_legal_documents ORDER BY document`).map((r) => r.document);
    expect(docs).toEqual(["accessibility", "child_safety", "privacy", "privacy_choices", "registration_terms", "terms"]);
  });
});
