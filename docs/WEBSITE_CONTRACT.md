# Website ⇄ CoachOS contract (v1)

risingstars.training reads and writes this database with the anon key. CoachOS is the
source of truth for anything operational; the website owns copy, pictures and SEO. These
are the only doors, and `tests/integration/website-contract.test.ts` pins their shape.
Changing one is a contract change: tell the website team first.

## Reads (anon, `public`, no PII)

| Object | What it is |
|---|---|
| `public.site_offerings` | One row per session (`ops.programs`) that is `active`/`upcoming` and published. A linked listing (`public.programs.ops_program_id`) decides with `published`; a session with no listing is published while its registration is open. Price, places, dates, venue and weekly times come from CoachOS; title, description, picture, ages, `featured`, `sort_order` and the slug come from the listing when set. `venue_city` is null (CoachOS has no city yet). |
| `public.program_availability` | Deprecated alias, unchanged. Drop once the website reads `site_offerings`. |
| `public.programs` | The marketing overlay. New: `published`, `featured`, `sort_order`, `slug`, `seo_title`, `seo_description`. For a linked listing `price`, `slots`, `date_range`, `start_date`, `end_date` and `location` are kept equal to the session by the database; the Website page doesn't edit them. |

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
