# Audit & Compliance

The owner's ask: *"an audit and compliance section in CoachOS that allows my wife or assistants to fill these
values after researching."* "These values" are the business and legal facts the website's policy pages are built
from (contract v1.4, `docs/WEBSITE_CONTRACT_v1.4.md`).

**Not legal advice.** The research guidance and links were written on 2026-10-05; laws and pages change. The
annual attorney review (Checklist) is where the facts are confirmed.

## Where it lives

Sidebar → **Audit & Compliance** (`/compliance`). Tabs:

| Tab | Who | What |
|---|---|---|
| Policy facts | admin, compliance | Every fact, grouped by category, with status chip, last verified, review due; edit drawer; publish bar |
| Checklist | admin, compliance | Recurring compliance tasks with owner and due date; mark done with notes, evidence link, private details |
| Privacy requests | admin | Unchanged (feat/compliance) |
| Coach clearance | admin | Unchanged |
| Incidents | admin | Unchanged |
| Data kept | admin | Unchanged |
| Audit log | admin (all), compliance (facts + checklist only) | Every change, who/when/old → new, filterable by kind, person, dates |

## Policy facts

- **Statuses** (`ops.legal_fact_versions.status`): `draft` · `needs_research` · `in_review` · `published`.
  Each fact has at most one published value (what the website shows) and one working copy.
- **Chips**: *Verified* (a person confirmed the published value) · *Verify* (a seeded website default nobody has
  checked) · *Needs research* · *Draft* · *In review* · *Set in website code* (read-only technical keys).
- **Drawer**: what to research and where (per-fact help + authoritative links), the value on the website now, the
  new value with a live preview of its sentence on the website and a word diff, research notes, source links,
  and *Save draft*, *Needs research*, *Send for review*, *Discard draft* and — admins only — *Publish*.
- **Sending an unchanged value for review** is how a fact gets verified without changing the website wording.
- **Publish bar**: appears when anything is in review; shows which documents get a new version and the version
  label. Admin → *Publish changes* publishes everything in review in one go (`ops.publish_legal_facts`).
- **Review cycle**: publishing sets `review_due` to 12 months out (`legal_facts.review_months`); seeded defaults are
  due now. Filters: Needs research · Due for review (unverified, or due within 14 days) · Drafts · In review.
- **Progress meter**: "N of 33 verified" counts editable facts whose published value is verified.

## Checklist (seeded)

| Task | Cadence | Notes |
|---|---|---|
| Attorney review of the policies | yearly | records reviewer |
| Insurance renewal | yearly | carrier / policy no. / expiry recorded **privately**; next due = 30 days before expiry |
| Google Analytics settings check | quarterly | Google signals off, ads personalization off, 14-month retention |
| Texas No-Call list check | quarterly | before any promotional texting |
| Assumed-name (d/b/a) certificate on file | yearly | SOS Form 503; filing no. + expiry recorded |
| Coach clearance review | monthly | links to Coach clearance; admin sees the not-cleared count |
| Privacy requests due | weekly | links to Privacy requests; admin sees open/overdue counts |
| Breach runbook drill | yearly | table-top exercise |

Marking done rolls the due date on the task's cadence from the old due date (skipping past today if late), or
to 30 days before a recorded `expires_on` if that is later (`ops.compliance_next_due`).

## Roles

| | admin | compliance |
|---|---|---|
| `app_metadata.role` | `admin` | `compliance` |
| Pages | everything | `/compliance` only (middleware redirects everything else there) |
| Policy facts / checklist | read, edit, send for review, **publish** | read, edit, send for review |
| Families, children, medical notes, payments, messages, incidents, privacy requests | yes | **no** — `ops.is_admin()` is false, so every RLS policy refuses; existing server actions use the admin-only `currentUser()` |
| Audit log | everything | `legal.*` and `checklist.*` entries only (RLS policy) |

Invite from **Settings → Access** with *They can see: Audit & Compliance only*. Same invite email flow; the
welcome page sends them to `/compliance`. Re-inviting with the other role changes it; *Remove* takes access away
at once (roles are read live from `auth.users`).

Enforcement is in three places: middleware (pages), server actions (`currentStaff()` + admin check for publish),
and the database (RLS policies with `ops.can_manage_compliance()` / `ops.staff_role()`, and the SECURITY DEFINER
write functions re-check the role — `publish_legal_facts` requires `ops.is_admin()`). Tables are read-only through
the API; every write goes through a function.

## Audit

Every save, status change, discard, publish, new document version, checklist completion and checklist edit
writes to the append-only `ops.audit_log` (from inside the database functions) with the actor
(`admin:<email>` / `compliance:<email>`), the action (`legal.fact.save|submit|needs_research|discard|publish`,
`legal.document.version`, `checklist.complete|update`), and `old_value → new_value` / `old_due → new_due`.
Private checklist details (e.g. an insurance policy number) are **not** copied into the log — it records which
fields were recorded.

## Data

| Object | Migration |
|---|---|
| `ops.staff_role()`, `ops.can_manage_compliance()`, `ops.staff_actor()` | 20261007000400 |
| `ops.legal_facts`, `ops.legal_fact_versions`, `ops.legal_document_versions` | 20261007000400 |
| `ops.save_legal_fact`, `ops.discard_legal_fact_draft`, `ops.publish_legal_facts`, `ops.next_legal_document_version` | 20261007000400 |
| Seed: 47 facts with help text, links and website sentence; versions; document baselines | 20261007000410 (generated from the website's `docs/LEGAL_FACT_KEYS.json`) |
| `public.site_legal_facts`, `public.site_legal_documents` | 20261007000420 |
| `ops.compliance_tasks`, `ops.compliance_task_completions`, `ops.complete_compliance_task`, `ops.update_compliance_task`, `ops.compliance_next_due` + seed | 20261007000430 |

Adding a fact later: the website team adds the key to `LEGAL_FACT_KEYS.json`; CoachOS adds an `INSERT` into
`ops.legal_facts` (and a seed version) in a new migration.

## Code

- `apps/web/src/lib/legal-facts.ts`, `lib/compliance-checklist.ts`, `lib/audit-kinds.ts` — pure rules
- `apps/web/src/lib/queries/audit-compliance.ts` — reads through the user's own session (RLS decides)
- `apps/web/src/lib/actions/legal-facts.ts`, `lib/actions/compliance-checklist.ts` — thin wrappers over the RPCs
- `apps/web/src/components/policy-facts-panel.tsx`, `compliance-checklist-panel.tsx`, `audit-log-panel.tsx`, `ui/sheet.tsx`
- Roles: `lib/admin.ts` (`staffRole`, `homeFor`, `complianceMayOpen`), `lib/auth-guard.ts` (`currentStaff`),
  `lib/supabase/middleware.ts`, `lib/actions/access.ts`, `components/access-card.tsx`

## Tests

- `tests/integration/audit-compliance.test.ts` — seed, research → review → publish, versions, refusals, audit, checklist
- `tests/integration/compliance-role.test.ts` — the compliance role reads no row of any other `ops` table (with
  children, medical notes, payments, messages present), changes nothing, invite/list/remove
- `tests/integration/legal-facts-lib.test.ts` — states, filters, progress, diff, preview, version labels
- `tests/integration/website-contract.test.ts` — view columns, anon grants, owner rights
- `tests/e2e/audit-compliance.spec.ts` — assistant edits and sends for review → admin publishes →
  `public.site_legal_facts` has the new value and a new document version exists
