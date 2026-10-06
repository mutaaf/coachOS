-- ============================================================================
-- Audit & Compliance: a compliance role, and the policy facts the website's
-- legal pages are built from (contract v1.4).
--
-- The owner's wife or an assistant researches each fact (the legal entity,
-- the refund rule, the heat policy, how long records are kept…) and sends it
-- for review; an admin publishes. Published values reach the website through
-- public.site_legal_facts (20261007000420) with no deploy.
--
-- The compliance role (app_metadata.role = 'compliance') sees these tables and
-- the checklist, and nothing else: ops.is_admin() is false for it, so every
-- policy on families, children, medical notes, payments and messages keeps it
-- out. It can never publish.
--
-- Writes go only through the SECURITY DEFINER functions below, which check the
-- role read live from auth.users (like ops.is_admin()) and write every change
-- to the append-only ops.audit_log.
-- ============================================================================

SET search_path = ops, public, extensions;

-- ---------------------------------------------------------------- the roles

-- 'admin' or 'compliance' for staff, null for anyone else. Read live: taking
-- someone's access away bites at once, not when their token expires.
CREATE OR REPLACE FUNCTION ops.staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN r IN ('admin', 'compliance') THEN r END
    FROM (SELECT raw_app_meta_data ->> 'role' AS r FROM auth.users WHERE id = auth.uid()) u
$$;

CREATE OR REPLACE FUNCTION ops.can_manage_compliance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ops.staff_role() IS NOT NULL
$$;

-- Who did it, in the audit log's words: 'admin:<email>', 'compliance:<email>'.
CREATE OR REPLACE FUNCTION ops.staff_actor()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT (raw_app_meta_data ->> 'role') || ':' || coalesce(email, id::text) FROM auth.users WHERE id = auth.uid()),
    'unknown'
  )
$$;

REVOKE ALL ON FUNCTION ops.staff_role(), ops.can_manage_compliance(), ops.staff_actor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.staff_role(), ops.can_manage_compliance(), ops.staff_actor() TO authenticated, service_role;

-- ------------------------------------------------------------------ tables

CREATE TABLE IF NOT EXISTS ops.legal_facts (
  -- The website's LEGAL key: `refundWindow`, `retention.medical`.
  key           text        PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)?$'),
  label         text        NOT NULL,
  category      text        NOT NULL,
  -- What the fact means, what to check and where.
  help          text        NOT NULL,
  -- Authoritative places to check it: [{label, url}].
  links         jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
  -- False for values set in the website's code (phone, URLs, brand).
  editable      boolean     NOT NULL DEFAULT true,
  -- Which website documents show it; a published change versions each one.
  documents     text[]      NOT NULL DEFAULT '{}'
                CHECK (documents <@ ARRAY['privacy', 'terms', 'registration_terms', 'child_safety', 'accessibility', 'privacy_choices']::text[]),
  -- The sentence it sits in on the website, {value} where the fact goes.
  preview       text,
  review_months integer     NOT NULL DEFAULT 12 CHECK (review_months BETWEEN 1 AND 60),
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.legal_fact_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text        NOT NULL REFERENCES ops.legal_facts (key) ON DELETE CASCADE,
  value          text        NOT NULL DEFAULT '' CHECK (length(value) <= 4000),
  status         text        NOT NULL CHECK (status IN ('draft', 'needs_research', 'in_review', 'published')),
  -- False only for published defaults nobody has checked yet ("verify").
  verified       boolean     NOT NULL DEFAULT false,
  research_notes text        CHECK (length(research_notes) <= 10000),
  sources        text[]      NOT NULL DEFAULT '{}',
  edited_by      text        NOT NULL,
  edited_by_id   uuid,
  edited_at      timestamptz NOT NULL DEFAULT now(),
  submitted_by   text,
  submitted_at   timestamptz,
  reviewed_by    text,
  reviewed_by_id uuid,
  published_at   timestamptz,
  review_due     date,
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);

-- One working copy (draft / needs research / in review) per fact at a time.
CREATE UNIQUE INDEX IF NOT EXISTS legal_fact_versions_one_working
  ON ops.legal_fact_versions (key) WHERE status <> 'published';
CREATE INDEX IF NOT EXISTS legal_fact_versions_published
  ON ops.legal_fact_versions (key, published_at DESC) WHERE status = 'published';

-- A published version is history: never edited afterwards.
CREATE OR REPLACE FUNCTION ops.legal_fact_published_is_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'A published version can''t be changed; save a new one.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_fact_published_is_final ON ops.legal_fact_versions;
CREATE TRIGGER legal_fact_published_is_final
  BEFORE UPDATE ON ops.legal_fact_versions
  FOR EACH ROW EXECUTE FUNCTION ops.legal_fact_published_is_final();

CREATE TABLE IF NOT EXISTS ops.legal_document_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document        text        NOT NULL
                  CHECK (document IN ('privacy', 'terms', 'registration_terms', 'child_safety', 'accessibility', 'privacy_choices')),
  -- 2026-11-02, then 2026-11-02.2, .3 for same-day republishes.
  version         text        NOT NULL CHECK (version ~ '^\d{4}-\d{2}-\d{2}(\.\d+)?$'),
  effective_date  date        NOT NULL,
  -- The facts whose change made this version.
  fact_keys       text[]      NOT NULL DEFAULT '{}',
  published_by    text        NOT NULL,
  published_by_id uuid,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (document, version)
);

CREATE INDEX IF NOT EXISTS legal_document_versions_latest
  ON ops.legal_document_versions (document, created_at DESC);

-- --------------------------------------------------------------------- RLS

ALTER TABLE ops.legal_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.legal_fact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.legal_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Compliance staff read policy facts" ON ops.legal_facts;
CREATE POLICY "Compliance staff read policy facts" ON ops.legal_facts FOR SELECT TO authenticated
  USING ((SELECT ops.can_manage_compliance()));
DROP POLICY IF EXISTS "Compliance staff read fact versions" ON ops.legal_fact_versions;
CREATE POLICY "Compliance staff read fact versions" ON ops.legal_fact_versions FOR SELECT TO authenticated
  USING ((SELECT ops.can_manage_compliance()));
DROP POLICY IF EXISTS "Compliance staff read document versions" ON ops.legal_document_versions;
CREATE POLICY "Compliance staff read document versions" ON ops.legal_document_versions FOR SELECT TO authenticated
  USING ((SELECT ops.can_manage_compliance()));

-- Read-only through the API; every write goes through the functions below.
REVOKE ALL ON ops.legal_facts, ops.legal_fact_versions, ops.legal_document_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ops.legal_facts, ops.legal_fact_versions, ops.legal_document_versions TO authenticated;
GRANT ALL ON ops.legal_facts, ops.legal_fact_versions, ops.legal_document_versions TO service_role;

-- The compliance role reads its own corner of the audit log: policy facts and
-- the checklist. Everything else there (medical views, privacy, incidents)
-- stays admin-only.
DROP POLICY IF EXISTS "Compliance staff read policy and checklist history" ON ops.audit_log;
CREATE POLICY "Compliance staff read policy and checklist history" ON ops.audit_log FOR SELECT TO authenticated
  USING ((SELECT ops.staff_role()) = 'compliance' AND (action LIKE 'legal.%' OR action LIKE 'checklist.%'));

-- A publish writes several audit rows in one transaction; now() would give
-- them all the same time and the log could show them in any order.
ALTER TABLE ops.audit_log ALTER COLUMN at SET DEFAULT clock_timestamp();

-- --------------------------------------------------------------- functions

-- Save a fact's working copy: a draft, "needs research", or sent for review.
-- Admin and compliance staff alike; publishing is separate and admin-only.
CREATE OR REPLACE FUNCTION ops.save_legal_fact(
  p_key            text,
  p_value          text,
  p_research_notes text DEFAULT NULL,
  p_sources        text[] DEFAULT '{}',
  p_status         text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role    text := ops.staff_role();
  v_actor   text := ops.staff_actor();
  v_fact    ops.legal_facts;
  v_work    ops.legal_fact_versions;
  v_pub     ops.legal_fact_versions;
  v_value   text := btrim(coalesce(p_value, ''));
  v_notes   text := nullif(btrim(coalesce(p_research_notes, '')), '');
  v_sources text[];
  v_id      uuid;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Only CoachOS staff can edit policy facts.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'needs_research', 'in_review') THEN
    RAISE EXCEPTION 'Save a fact as a draft, mark it as needing research, or send it for review.' USING ERRCODE = '22023';
  END IF;

  -- Locks the fact, so two people saving at once take turns.
  SELECT * INTO v_fact FROM ops.legal_facts WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no policy fact called %.', p_key USING ERRCODE = '22023';
  END IF;
  IF NOT v_fact.editable THEN
    RAISE EXCEPTION '% is set in the website''s code and can''t be changed here.', v_fact.label USING ERRCODE = '42501';
  END IF;
  IF v_value ~ '<\s*/?\s*[A-Za-z!]' THEN
    RAISE EXCEPTION 'Plain text only — the website doesn''t accept HTML.' USING ERRCODE = '22023';
  END IF;
  IF length(v_value) > 4000 THEN
    RAISE EXCEPTION 'That''s too long (4,000 characters at most).' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'in_review' AND (v_value = '' OR v_value ILIKE '[CONFIRM%') THEN
    RAISE EXCEPTION 'Fill in the value before sending it for review.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(s ORDER BY n), '{}') INTO v_sources
    FROM (SELECT btrim(x) AS s, n FROM unnest(coalesce(p_sources, '{}')) WITH ORDINALITY AS t(x, n)) u
   WHERE s <> '';
  IF EXISTS (SELECT 1 FROM unnest(v_sources) s WHERE s !~* '^https?://[^[:space:]]+$' OR length(s) > 2000) THEN
    RAISE EXCEPTION 'Source links must be web addresses starting with http:// or https://.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(v_sources, 1), 0) > 20 THEN
    RAISE EXCEPTION 'Twenty source links at most.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pub FROM ops.legal_fact_versions
   WHERE key = p_key AND status = 'published' ORDER BY published_at DESC LIMIT 1;
  SELECT * INTO v_work FROM ops.legal_fact_versions WHERE key = p_key AND status <> 'published';

  IF v_work.id IS NOT NULL THEN
    UPDATE ops.legal_fact_versions
       SET value = v_value, status = p_status, research_notes = v_notes, sources = v_sources,
           edited_by = v_actor, edited_by_id = auth.uid(), edited_at = now(),
           submitted_by = CASE WHEN p_status = 'in_review' THEN v_actor END,
           submitted_at = CASE WHEN p_status = 'in_review' THEN now() END
     WHERE id = v_work.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO ops.legal_fact_versions
      (key, value, status, research_notes, sources, edited_by, edited_by_id, submitted_by, submitted_at)
    VALUES
      (p_key, v_value, p_status, v_notes, v_sources, v_actor, auth.uid(),
       CASE WHEN p_status = 'in_review' THEN v_actor END, CASE WHEN p_status = 'in_review' THEN now() END)
    RETURNING id INTO v_id;
  END IF;

  PERFORM ops.audit(
    v_actor,
    CASE p_status WHEN 'in_review' THEN 'legal.fact.submit' WHEN 'needs_research' THEN 'legal.fact.needs_research' ELSE 'legal.fact.save' END,
    'legal_fact_versions',
    v_id,
    jsonb_build_object(
      'key', p_key,
      'from_status', coalesce(v_work.status, CASE WHEN v_pub.id IS NOT NULL THEN 'published' END),
      'to_status', p_status,
      'old_value', coalesce(v_work.value, v_pub.value),
      'new_value', v_value,
      'published_value', v_pub.value,
      'sources', to_jsonb(v_sources)
    ),
    auth.uid()
  );
  RETURN v_id;
END;
$$;

-- Throw a working copy away; the published value stays.
CREATE OR REPLACE FUNCTION ops.discard_legal_fact_draft(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := ops.staff_actor();
  v_work  ops.legal_fact_versions;
BEGIN
  IF NOT ops.can_manage_compliance() THEN
    RAISE EXCEPTION 'Only CoachOS staff can edit policy facts.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM ops.legal_facts WHERE key = p_key FOR UPDATE;
  DELETE FROM ops.legal_fact_versions WHERE key = p_key AND status <> 'published' RETURNING * INTO v_work;
  IF v_work.id IS NULL THEN
    RAISE EXCEPTION 'There''s no draft to discard.' USING ERRCODE = '22023';
  END IF;
  PERFORM ops.audit(v_actor, 'legal.fact.discard', 'legal_fact_versions', v_work.id,
    jsonb_build_object('key', p_key, 'from_status', v_work.status, 'to_status', 'discarded', 'old_value', v_work.value),
    auth.uid());
END;
$$;

-- The next version label for a document on a given day: 2026-11-02, then
-- 2026-11-02.2, 2026-11-02.3 if it is republished the same day.
CREATE OR REPLACE FUNCTION ops.next_legal_document_version(p_document text, p_day date)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN n = 0 THEN d ELSE d || '.' || (n + 1) END
    FROM (SELECT to_char(p_day, 'YYYY-MM-DD') AS d) x,
         LATERAL (
           SELECT coalesce(max(CASE WHEN version = x.d THEN 1 ELSE split_part(version, '.', 2)::int END), 0) AS n
             FROM ops.legal_document_versions
            WHERE document = p_document AND (version = x.d OR version LIKE x.d || '.%')
         ) c
$$;

-- Publish every fact that is in review (or just the ones named). Admin only.
-- A fact whose value changed gives each of its documents a new version, dated
-- today in Texas; a fact confirmed unchanged is only marked verified.
CREATE OR REPLACE FUNCTION ops.publish_legal_facts(p_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor     text := ops.staff_actor();
  v_today     date := (now() AT TIME ZONE 'America/Chicago')::date;
  r           record;
  v_doc       text;
  v_version   text;
  v_published text[] := '{}';
  v_changed   text[] := '{}';
  v_doc_keys  jsonb := '{}'::jsonb;
  v_docs      jsonb := '[]'::jsonb;
BEGIN
  IF NOT ops.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can publish policy facts to the website.' USING ERRCODE = '42501';
  END IF;
  -- One publish at a time, so two can't mint the same document version.
  PERFORM pg_advisory_xact_lock(hashtext('ops.publish_legal_facts'));

  FOR r IN
    SELECT w.id, w.key, w.value, f.documents, f.review_months,
           (SELECT p.value FROM ops.legal_fact_versions p
             WHERE p.key = w.key AND p.status = 'published'
             ORDER BY p.published_at DESC LIMIT 1) AS prev_value
      FROM ops.legal_fact_versions w
      JOIN ops.legal_facts f ON f.key = w.key
     WHERE w.status = 'in_review' AND f.editable AND (p_keys IS NULL OR w.key = ANY (p_keys))
     ORDER BY w.key
       FOR UPDATE OF w
  LOOP
    UPDATE ops.legal_fact_versions
       SET status = 'published', published_at = now(), verified = true,
           reviewed_by = v_actor, reviewed_by_id = auth.uid(),
           review_due = (v_today + make_interval(months => r.review_months))::date
     WHERE id = r.id;
    v_published := v_published || r.key;
    IF r.prev_value IS DISTINCT FROM r.value THEN
      v_changed := v_changed || r.key;
      FOREACH v_doc IN ARRAY r.documents LOOP
        v_doc_keys := jsonb_set(v_doc_keys, ARRAY[v_doc], coalesce(v_doc_keys -> v_doc, '[]'::jsonb) || to_jsonb(r.key));
      END LOOP;
    END IF;
    PERFORM ops.audit(v_actor, 'legal.fact.publish', 'legal_fact_versions', r.id,
      jsonb_build_object('key', r.key, 'from_status', 'in_review', 'to_status', 'published',
                         'old_value', r.prev_value, 'new_value', r.value, 'changed', r.prev_value IS DISTINCT FROM r.value),
      auth.uid());
  END LOOP;

  IF coalesce(array_length(v_published, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nothing is waiting to be published.' USING ERRCODE = '22023';
  END IF;

  FOR v_doc IN SELECT k FROM jsonb_object_keys(v_doc_keys) AS k ORDER BY k LOOP
    v_version := ops.next_legal_document_version(v_doc, v_today);
    INSERT INTO ops.legal_document_versions (document, version, effective_date, fact_keys, published_by, published_by_id)
    VALUES (v_doc, v_version, v_today, ARRAY(SELECT jsonb_array_elements_text(v_doc_keys -> v_doc)), v_actor, auth.uid());
    v_docs := v_docs || jsonb_build_object('document', v_doc, 'version', v_version);
    PERFORM ops.audit(v_actor, 'legal.document.version', 'legal_document_versions', NULL,
      jsonb_build_object('document', v_doc, 'version', v_version, 'keys', v_doc_keys -> v_doc), auth.uid());
  END LOOP;

  RETURN jsonb_build_object('published', to_jsonb(v_published), 'changed', to_jsonb(v_changed), 'documents', v_docs);
END;
$$;

REVOKE ALL ON FUNCTION ops.save_legal_fact(text, text, text, text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.discard_legal_fact_draft(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.next_legal_document_version(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.publish_legal_facts(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.save_legal_fact(text, text, text, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.discard_legal_fact_draft(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.next_legal_document_version(text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.publish_legal_facts(text[]) TO authenticated, service_role;
