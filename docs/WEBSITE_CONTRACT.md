# Website ⇄ CoachOS contract (v1.4)

risingstars.training reads and writes this database with the anon key. CoachOS is the
source of truth for anything operational; the website owns copy, pictures and SEO. These
are the only doors, and `tests/integration/website-contract.test.ts` pins their shape.
Changing one is a contract change: tell the website team first.

## Reads (anon, `public`, no PII)

| Object | What it is |
|---|---|
| `public.site_offerings` | One row per session (`ops.programs`) that is `active`/`upcoming` and published. A linked listing (`public.programs.ops_program_id`) decides with `published`; a session with no listing is published while its registration is open. Price, places, dates, venue and weekly times come from CoachOS; title, description, picture, ages, `featured`, `sort_order` and the slug come from the listing when set. `venue_city` is null (CoachOS has no city yet). |
| `public.site_media` | v1.2. One row per placement of a published photo: `id, slot, offering_id, sort_order, alt, caption, focal_x, focal_y, width, height, url, srcset, updated_at`. Only photos that are published, described and — when they show recognizable children — have a confirmed photo release appear; the view itself enforces it. See "Site photos" below. |
| `public.program_availability` | Deprecated alias, unchanged. Drop once the website reads `site_offerings`. |
| `public.programs` | The marketing overlay. New: `published`, `featured`, `sort_order`, `slug`, `seo_title`, `seo_description`. For a linked listing `price`, `slots`, `date_range`, `start_date`, `end_date` and `location` are kept equal to the session by the database; the Website page doesn't edit them. |

### Site photos (v1.2)

The owner manages the site's pictures on CoachOS's Website → Photos tab. Nothing is deployed:
the website reads `public.site_media` (and `site_offerings.image_url`) at runtime, so a change is
live as soon as the site's own cache lets it (aim for ≤ 60 s revalidation).

- **Slots.** `hero` (several, ordered by `sort_order` — a slideshow), `programs_section`,
  `levels_section`, `about`, `partnerships_section`, `contact_section`, `og_default`,
  `offering` (one per session; `offering_id` = `site_offerings.offering_id`) and
  `sport:<sport>` (lower-case, e.g. `sport:basketball`, `sport:flag football`). CoachOS keeps one
  photo per non-hero slot, but read them ordered by `sort_order` and take the first. A slot with
  no row means "use the site's built-in picture".
- **Files.** Bucket `site-media` (public read; only CoachOS's server writes — a restrictive policy
  blocks anon and signed-in users even if a broader storage policy exists). `url` is the original,
  turned upright and with all metadata (EXIF/GPS) removed. `srcset` is WebP at 480, 960 and 1600
  wide where the original is at least that wide (never upscaled), plus one at the original's own
  width when it is under 1600 and no size is within 10% — so a 1000-wide photo has
  `[480, 960]`, a 900-wide one `[480, 900]`, a 300-wide one `[300]`. Use `url` only as a
  fallback; `srcset` may be `[]` if the server could not resize (then `width`/`height` may be
  null too). File paths change when a photo is replaced, so URLs can be cached forever.
- **Focal point.** `focal_x`/`focal_y` are 0–1 from the left/top; use
  `object-position: {x*100}% {y*100}%` with `object-fit: cover`.
- **`alt` is always non-empty.** Use it as the image's `alt`; `caption` is optional display text.

`site_offerings.image_url` resolves, in order: the session's own `offering` photo → the listing's
`programs.image` → the program's `program_catalog.image` (as before v1.2) → the `sport:<sport>`
photo → null. For photo-library images it is the widest `srcset` entry (≤ 1600), else the
original. The column list is unchanged.

### Legal facts (v1.4)

Implemented by migrations `20261007000400`–`20261007000430`; pinned by `tests/integration/website-contract.test.ts`.

#### The two views

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

## Writes (anon → SECURITY DEFINER, `search_path = ''`)

- `public.submit_inquiry(p_kind, p_contact, p_details, p_attribution) → uuid`. `partnership`
  goes to `ops.leads` (stage `identified`, `source = 'website'`), the rest to `ops.inquiries`.
  The limit is 5 an hour per phone or email and 30 a minute overall.
- `public.submit_registration_v2(p_offering_id, p_parent, p_children, p_consents, p_attribution, p_idempotency_key) → jsonb`
  registers every child or none. It accepts up to 8 children and requires `terms: true`. It
  keeps v1's limit of 10 children an hour per phone and adds 60 a minute overall. It returns
  `{notify_token, outcomes[]}`, and the same key returns the same result. v1 is unchanged.
- `POST /api/registrations/notify` with `{registration_ids, token}` returns
  `{ok, whatsappGroupUrl}`. A bad or expired token gets 403 and a malformed body gets 400.
  The legacy body still works until `NOTIFY_LEGACY_ENABLED=false`, after which it gets 410.

### v1.1 — compliance (2026-10-06)

- `submit_inquiry` also takes `p_kind = 'privacy_request'` with
  `p_details = {request_type: access|delete|correct|opt_out|appeal, child_first_names: text[], message}`.
  An unknown `request_type` is refused. It lands in `ops.inquiries` with a 45-day due date (60 for
  `appeal`) and is worked on CoachOS's Compliance page, not the Marketing page.
- `submit_inquiry` stores `p_details` verbatim in `ops.inquiries.details` (unknown keys kept,
  16 KB cap) and `p_details.consents` (`{sms, marketing_email, policy_version, documents{…}}`) in
  `ops.inquiries.consents` with the server's `accepted_at`. `sms` is dropped when no phone was given.
  An opt-in also counts for a family already on file with that phone/email.
- `submit_registration_v2` stores `p_consents` verbatim (unknown keys kept, 16 KB cap) plus
  `accepted_at` (server time; a browser's own is kept as `client_accepted_at`). `terms` must be true.
  When the registration is placed on the roster, `sms`/`marketing_email` go to the parent and `photo`
  to the child, with history in `ops.consent_log`.
- Consents are opt-ins. CoachOS texts nobody whose latest answer — on a registration, a contact form,
  or recorded by staff (e.g. STOP) — is "no", and sends promotions (texts or email) only on a "yes".
  This matches the website's "we'll call you" when there's no email and no SMS consent.
- Marketing email carries `List-Unsubscribe` / `List-Unsubscribe-Post` pointing at
  `{COACHOS_URL}/api/unsubscribe?t=<token>`.

### v1.3 — promotional texts, quiet hours, youth camps (2026-10-05)

Owner facts: Rising Stars is an SBA small business, holds no DSHS youth camp license, and is
**not registered** as a Texas telephone solicitor (Bus. & Com. Code ch. 302 / SB 140).

- **New consent key `sms_promotional`** in `submit_registration_v2`'s `p_consents` and
  `submit_inquiry`'s `p_details.consents` (boolean). `sms` now means program/operational texts
  only (updates, schedule changes, cancellations, reminders); `sms_promotional` is prior express
  written consent to marketing texts (new programs, offers) from Rising Stars Youth Academy.
- CoachOS stores it with the other consents (verbatim, server `accepted_at`), copies it to the
  parent when a registration is placed (`ops.parents.sms_promotional_consent_at` /
  `…_opt_out_at`, history in `ops.consent_log` with `kind = 'sms_promotional'`), and records an
  inquiry's "yes" on the family already on file with that phone. Dropped when no phone was given.
- **A promotional text goes only to a parent whose latest `sms_promotional` answer is true.**
  `sms: true` alone never permits a promotion, and parents who only ever gave `sms` are not
  eligible (no backfill). A "no" to `sms` (or a STOP) is a no to promotions too.
- The contact form's single SMS box ("this inquiry and programs I may be interested in") sends
  `sms: true, sms_promotional: true` together. The registration form asks separately.
- Promotional texts keep Texas quiet hours (§301.051): Mon–Sat 9:00–21:00, Sun 12:00–21:00,
  America/Chicago. CoachOS refuses to queue or mark sent a promotion outside them; operational
  texts are unaffected.
- **Youth camps.** A session whose weekly times (within its dates) or dated practices cover
  4 or more consecutive days does not appear in `site_offerings`' sources unless a DSHS youth camp
  license number is on file for it: the database refuses to publish its listing, open it for
  sign-ups or add such a time while it's live (`ops.programs.youth_camp_license_number`, not
  exposed to the website). No change to `site_offerings`' columns.

Attribution is cleaned to `first_touch`/`last_touch` (`utm_*`, `gclid`, `fbclid`, `referrer`,
`landing_path`, `ts`) plus `ga_client_id`/`ga_session_id`, and stored on
`ops.registrations.attribution`, `ops.inquiries.attribution` and `ops.leads.attribution`.

## The notify token's secret

Token: `v1.<expiry unix seconds>.<hex HMAC-SHA256(secret, "<sorted ids comma-joined>|<expiry>")>`.

Migration `20261005000400` generates the secret at random when it runs. It stores it in
`ops.app_secrets`, which no API role can read (not anon, not admins, not the service role).
Only the database functions use it: v2 issues the token, and `ops.verify_notify_token`
(service role only) checks it for the notify route. CoachOS needs no environment variable for
it. To rotate it, run this in the Supabase SQL editor (tokens already issued stop working,
and they last an hour at most):

```sql
UPDATE ops.app_secrets
   SET value = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
 WHERE name = 'registration_notify_hmac';
```

## Shipping order

1. Apply the migrations `20261005000100`–`20261005000500` (additive; `...0500` rewrites the
   price, slots and dates of linked listings to CoachOS's values once).
2. Deploy CoachOS. Its Website page and notify route rely on the new columns and functions.
3. The website switches to `site_offerings`, `submit_inquiry`, `submit_registration_v2` and the
   token body. It falls back to the old path while these are missing.
4. Once the website has shipped, set `NOTIFY_LEGACY_ENABLED=false` in CoachOS on Vercel. Later,
   drop `public.program_availability`.

v1.2 (site photos, New program): apply `20261006000400`–`20261006000600` (additive; `...0500`
replaces `site_offerings` with the same columns), then deploy CoachOS. The website can read
`public.site_media` from then on, falling back to its built-in pictures while it is empty or
missing (`PGRST205`/`42P01`).

v1.3 (promotional texts, quiet hours, youth-camp guard): apply `20261007000100`–`20261007000200`
(additive: new columns, functions and triggers; `submit_inquiry`, `record_consent` and
`create_program_sessions` replaced with the same signatures), then deploy CoachOS. The website can
send `sms_promotional` before or after — an unknown key was already stored verbatim, and until the
migration runs nobody is eligible for promotions anyway under the new rule.
