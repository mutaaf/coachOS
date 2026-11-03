-- ============================================================================
-- What the website reads (contract v1.4): published policy facts and the
-- current version of each legal document. Anon, no deploy.
--
-- Both views run with their owner's rights, because anon has no USAGE on
-- `ops`. That makes every column here public: research notes, sources,
-- drafts and who edited never appear. tests/integration/website-contract
-- pins the columns.
-- ============================================================================

SET search_path = ops, public, extensions;

-- The latest published version of each fact the website lets CoachOS manage.
-- A newer draft or review doesn't hide it: the site keeps showing the
-- published value until a new one is published. Code-managed keys (phone,
-- URLs, brand) never appear, so the website's own value always wins for them.
CREATE OR REPLACE VIEW public.site_legal_facts AS
SELECT DISTINCT ON (v.key)
       v.key,
       v.value,
       v.published_at
  FROM ops.legal_fact_versions v
  JOIN ops.legal_facts f ON f.key = v.key
 WHERE v.status = 'published'
   AND f.editable
   AND btrim(v.value) <> ''
   AND v.value NOT ILIKE '[CONFIRM%'
 ORDER BY v.key, v.published_at DESC, v.id;

COMMENT ON VIEW public.site_legal_facts IS
  'Contract v1.4: published policy facts (key, value, published_at). Latest published version per key; never drafts, notes, sources or editors.';

-- The current version of each document: the newest one minted.
CREATE OR REPLACE VIEW public.site_legal_documents AS
SELECT DISTINCT ON (d.document)
       d.document,
       d.version,
       d.effective_date
  FROM ops.legal_document_versions d
 ORDER BY d.document, d.created_at DESC, d.id DESC;

COMMENT ON VIEW public.site_legal_documents IS
  'Contract v1.4: current version and effective date of each legal document.';

REVOKE ALL ON public.site_legal_facts, public.site_legal_documents FROM PUBLIC;
GRANT SELECT ON public.site_legal_facts, public.site_legal_documents TO anon, authenticated, service_role;
