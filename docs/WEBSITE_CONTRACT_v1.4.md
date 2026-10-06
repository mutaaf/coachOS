# Contract note: v1.4 — legal facts managed in CoachOS

> For the coordinator to merge into `docs/WEBSITE_CONTRACT.md` (Reads section).
> Implemented on branch `feat/audit-compliance`, migrations `20261007000400`–`20261007000430`.
> Pinned by `tests/integration/website-contract.test.ts`.

## Reads (anon, `public`, no PII)

| Object | Columns | Notes |
|---|---|---|
| `public.site_legal_facts` (view) | `key text`, `value text`, `published_at timestamptz` | One row per key: the **latest published** version. A newer draft or review never hides it. |
| `public.site_legal_documents` (view) | `document text`, `version text`, `effective_date date` | One row per document: the **current** (newest) version. |

Both views run with their owner's rights (anon has no USAGE on `ops`), `GRANT SELECT` to `anon, authenticated, service_role`.
They never expose research notes, sources, drafts, statuses or who edited.

### What the website can rely on

- **Keys**: the 47 keys of `docs/LEGAL_FACT_KEYS.json` (2026-10-05), copied into `ops.legal_facts` by
  `20261007000410_legal_facts_seed.sql`.
- **Only the 33 `editable` keys ever appear** in `site_legal_facts`. The 14 "Technical (not editable)" keys
  (`brandName`, `phoneDisplay`, `phoneE164`, `email`, `privacyEmail`, `serviceArea`, `siteUrl`, `coachOsUrl`,
  `instagramUrl`, `instagramHandle`, `governingLaw`, `ageRange`, `paymentProcessor`, `gaMeasurementId`) are listed in
  CoachOS read-only and are **never** returned, so the website's bundled value always wins for them.
- **Rows are never placeholders**: values that are blank or start with `[CONFIRM` are filtered in the view, and CoachOS
  refuses to send one for review. Plain text only: CoachOS rejects values containing HTML tags. ≤ 4,000 chars.
- **On deploy nothing changes**: every current website value is seeded as a published version (owner-confirmed ones
  marked verified, defaults flagged "verify"), so the view returns the bundled values verbatim (32 rows).
  `mailingAddress` is seeded as *needs research* (street number missing), so it is **absent** until filled and
  published — keep the bundled placeholder until then.
- **Document baselines**: all six documents are seeded at version `2026-10-05`, effective `2026-10-05`, matching
  `DOCUMENTS` in `src/config/legal.ts`.
- **New versions**: when an admin publishes, every document listed for a fact whose **value changed** gets a new version
  `YYYY-MM-DD` (today in America/Chicago), then `YYYY-MM-DD.2`, `.3` for same-day republishes. A fact re-confirmed
  unchanged only becomes "verified" — no new document version. Fact → documents mapping = `documents` in
  `LEGAL_FACT_KEYS.json`.
- **Documents**: `privacy`, `terms`, `registration_terms`, `child_safety`, `accessibility`, `privacy_choices`.

### Website rules (unchanged from v1.4 draft)

A published value replaces the bundled one; a missing row keeps the bundled default; a value starting `[CONFIRM`
is unfilled. Cache both views ≤ 60 s. Use `site_legal_documents` for `policy_version` (newest version) and
`documents` (per-document versions) in consent payloads, and show version + effective date on each page.
Fall back to bundled values on `PGRST205` / `42P01` / 404 (the views don't exist until CoachOS deploys).

### Clarifications vs. the v1.4 draft

1. "Only rows whose latest version is `published`" is implemented as **the latest published version per key** — a
   draft in progress doesn't remove the live value from the site.
2. `site_legal_documents` returns **one row per document** (the current version), not the history.
3. Non-editable (technical) keys are excluded from `site_legal_facts` (see above).
