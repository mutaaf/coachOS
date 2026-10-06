# Compliance — what the law asks, and what CoachOS does about it

Rising Stars Youth Academy runs youth sports programs for children aged 4–12 in
Dallas–Fort Worth, Texas. CoachOS holds the parents' contact details, the
children's names, dates of birth and medical notes, attendance, payments, and
messages. This page maps each law that touches that data or those children to
what the software does and what the owner still has to do herself.

> **Not legal advice.** This was written by engineers from the statutes and
> regulators' guidance, as of October 2026. The privacy policy, terms,
> registration waiver, photo release, code of conduct and this runbook must be
> reviewed by a **Texas-licensed attorney** before they are relied on. Items
> marked **[CONFIRM]** depend on facts about the business we don't know.

### Facts the owner confirmed (5 Oct 2026)

| Fact | What follows |
|---|---|
| Rising Stars is a Texas **small business** under the SBA definition. | TDPSA (Bus. & Com. Code ch. 541) mostly doesn't apply (§541.002(a)(3)) — **except §541.107**: no selling of sensitive data (health information, a known child's data) without consent. Consumer rights are honoured **voluntarily**, with the same 45/60-day clocks. |
| It holds **no DSHS youth camp license** and runs **no youth camps**. | Nothing may run 4+ consecutive days with 5+ children (Health & Safety Code ch. 141). CoachOS blocks publishing such a session without a license number (below). |
| It is **approved by the school districts and charter schools** that host its programs. | Follow each host's vendor/volunteer clearance rules; keep the approvals on file. |
| It has **no national governing body** affiliation. | The federal Safe Sport Act (36 U.S.C. 220530) does not apply. Safeguarding stays as best practice. |
| It is **not registered** with the Texas Secretary of State as a telephone solicitor (Bus. & Com. Code ch. 302, SB 140). | Promotional texts go **only** to parents who gave prior express written consent to them (`sms_promotional`), only within Texas quiet hours, and every opt-out is honoured (below). |

## The matrix

| Law | What it requires (for us) | What CoachOS does | Owner action |
|---|---|---|---|
| **COPPA** — 15 U.S.C. 6501–6506; 16 CFR 312 (amended rule published 22 Apr 2025, compliance by 22 Apr 2026) | Applies to personal information collected online **from** children under 13. A form filled in by a parent about their child is generally outside it ([FTC FAQ A.8](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)). The amended rule's ideas — a written retention policy (§312.10) and a written security program (§312.8) — are good practice either way, and TDPSA §541.101(b)(4) ties children's data to COPPA. | Children never get accounts or enter data. Parents give consent on registration (`consents` stored verbatim with a server timestamp, `20261006000100`). Retention policy in code (`lib/retention.ts`, nightly job). Access limited to admins and the assigned coach, with an audit trail (`20261006000110`, `…0160`). | **[CONFIRM]** the website is not "directed to children" (no kids' games, chat, or features aimed at kids). Adopt this page's retention section as the written retention policy. |
| **Texas Data Privacy and Security Act** — Bus. & Com. Code ch. 541 | Applies to businesses that are **not** SBA small businesses (§541.002); a small business must still not *sell* sensitive data without consent (§541.107). "Sensitive data" includes health information and data from a known child (§541.001). Consumer rights: access, correct, delete, portability, opt out (§541.051). Answer within **45 days**, once extendable by 45 with notice (§541.052(b)); appeal process, answered within **60 days**, pointing to the AG if denied (§541.053). Exemptions for legal claims (§541.201(a)(3)) and legal obligations (§541.201(a)(1)). | Website privacy form → `submit_inquiry('privacy_request')` → **Compliance → Privacy requests**, with due dates and the received → verifying → completed / denied (reason required) → appealed → upheld / declined workflow, one extension, all audited. **Download their data** exports every operational table tied to the family as JSON (`ops.export_family`). **Erase family** anonymises names, contacts, DOB, medical notes, messages and website submissions, keeps invoice/payment amounts and dates (`ops.anonymize_family`), and keeps the request row as the record. Nothing is sold. | Small business (confirmed): the duties above are honoured **voluntarily**; **§541.107 does bind us** — never sell sensitive data (medical notes, children's data) without consent. Never sell or share family data at all. Verify identity by calling the number on file before acting. |
| **Texas breach notification** — Bus. & Com. Code §521.053 | Health information is "sensitive personal information" (§521.002(a)(2)(B)). Notify affected people within **60 days** of determining a breach; notify the **Attorney General within 30 days** if **250+ Texans** are affected, via the AG's online form; nationwide credit bureaus if **10,000+**. Penalties up to $50,000 per violation plus per-day late fees (§521.151). | Data is in Supabase (encrypted at rest), behind admin-only RLS (tested), with anon access only through narrow functions (tested). The audit log shows who viewed medical notes and exported/erased data. | Follow the **breach runbook** below. Keep the Supabase and Vercel accounts on 2-factor auth. |
| **TCPA** — 47 U.S.C. 227; 47 CFR 64.1200 | Autodialed or prerecorded calls/texts need consent. Texts **typed and sent by hand** from a phone are generally not "autodialed" (*Facebook v. Duguid*, 592 U.S. 395 (2021)). Marketing texts are still "telephone solicitations" for the Do-Not-Call rules (FCC 23-107). Consent can be revoked by **any reasonable means** (STOP, QUIT, END, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE) and must be honoured within **10 business days** (§64.1200(a)(10), effective 11 Apr 2025; the "revoke-all" provision is delayed to 31 Jan 2027). | **No SMS provider and no automation**: every WhatsApp/SMS is opened from the Outbox and sent by hand from the owner's phone (ADR, CLAUDE.md). Replies reach her phone, not CoachOS, so STOP/HELP are recorded by hand on the family page ("They said STOP"); `lib/sms-keywords.ts` holds the keyword rules for when an inbound webhook exists. The database gates every message into the Outbox (`20261006000130`, `20261007000100`): a parent whose latest answer is "no" — a STOP, or not ticking "texts" on the website's registration or contact form — gets **nothing** (queued messages are filed as skipped, with the reason); a **promotion** goes only to a parent whose latest **promotional** answer (`sms_promotional`) is "yes" — program-text consent is not enough (see the Texas row). Program texts (practice, payment) to a family who gave their number and never answered are sent on the basis of the existing relationship and the number they provided for it. | Record every STOP the same day. Never send promotions from WhatsApp outside CoachOS to parents who haven't agreed. If texts are ever automated (Twilio, WhatsApp Business API), consent becomes mandatory for all of them and a STOP/HELP webhook must be built first. |
| **Texas telephone solicitation** — Bus. & Com. Code ch. 302 (SB 140, effective 1 Sep 2025, adds texts), §301.051 (hours), ch. 304 (Texas no-call list), ch. 305 | Sellers soliciting by text must register with the Secretary of State unless exempt. Rising Stars is **not registered** (owner, 5 Oct 2026), so it relies on consent: promotional texts only to people who gave **prior express written consent** to them (the basis the AG's Nov 2025 settlement accepted). No solicitation before 9 a.m. or after 9 p.m. Mon–Sat, or before noon or after 9 p.m. Sun (§301.051). Numbers on the Texas no-call list (ch. 304) must not get telemarketing without consent. Violations are DTPA violations. | **Separate consent** `sms_promotional` (website contract v1.3): recorded from registrations (`p_consents`) and inquiries (`p_details.consents`), by staff on the family page ("They agreed in writing to promotional texts"), kept in the consent history. A message marked **promotion** in Compose is filed as skipped for anyone without a current "yes" ("hasn't agreed to promotional texts") — **no backfill**: parents who only agreed to program texts are not eligible. A STOP withdraws both. **Quiet hours**: Compose refuses to queue a promotion outside the hours, the Outbox holds them, and the database refuses to mark one sent (`ops.promotional_text_allowed`, America/Chicago, DST-tested). Program texts are unaffected. | Send promotions only from Compose with **This is a promotion** ticked — never from WhatsApp directly. Never text purchased or scraped numbers. If promotions to non-consenting numbers are ever wanted, register under ch. 302 first (with counsel). |
| **CAN-SPAM** — 15 U.S.C. 7701–7713; 16 CFR 316. Gmail/Yahoo bulk-sender rules (2024) | Commercial email: accurate headers, a valid **postal address** (PO box / private mailbox OK), a working opt-out honoured within **10 business days** and working for 30 days after sending. Transactional/relationship email is exempt from most of it. Bulk senders need one-click unsubscribe (RFC 8058). | Receipts, reminders, welcomes stay transactional (`lib/email.ts`). Marketing email only through `sendMarketingEmail` (`lib/marketing-email.ts`): requires the parent's opt-in and no opt-out, checks the **suppression list** (`ops.email_suppressions`; `all` = bounce/complaint stops everything, `marketing` = unsubscribe), refuses to send without the **postal address** setting, adds a footer with the address and an unsubscribe link, and the `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. `/api/unsubscribe` unsubscribes on POST (one click) and only shows a confirm page on GET, so link scanners don't unsubscribe anyone. | **[CONFIRM]** fill in **Settings → Mailing Address (for newsletters)** — newsletters won't send until it's set. If newsletters go out from another tool (Mailchimp etc.), export unsubscribes into CoachOS and vice versa. |
| **Texas Family Code §261.101** — reporting abuse or neglect | **Anyone** who suspects a child is abused or neglected must report **immediately**; professionals (licensed/certified) within **24 hours**, and they can't delegate it (§261.101(a)–(b)). Report to DFPS (1-800-252-5400, txabusehotline.org) or law enforcement (§261.103). Knowingly failing to report is a Class A misdemeanor (§261.109). | **Compliance → Incidents** shows the hotline and the duty at the top; a "safeguarding" incident records when it was reported and the reference, and shows "Not yet reported" in red until it is. Incidents are admin-only and never erased. | Train every coach: they report themselves, immediately; they also tell the owner. Put the hotline number in the coach handbook. |
| **Texas youth camps** — Health & Safety Code ch. 141; 25 TAC ch. 265 subch. B | A **day camp** (5+ minors, 4+ consecutive days, 7am–10pm) is a youth camp needing a **DSHS license** (§141.002–.003). Camp staff need DSHS-approved sexual-abuse/child-molestation training every 2 years (§141.0095) and annual criminal + sex-offender registry checks (25 TAC §265.12). Rising Stars holds **no license and runs no camps** (owner, 5 Oct 2026). | **Youth-camp guard** (`lib/youth-camp.ts`, `20261007000200`): the New program flow and the schedule template editor warn as soon as a session's weekly times (within its dates) or dated practices cover **4+ consecutive days** (Mon–Thu, a camp week, Sat–Tue). Such a session can't be **on the website** — a published listing, or open for sign-ups — unless an admin ticks "We hold a current DSHS youth camp license" and enters its number, which is stored on the session (`programs.youth_camp_license_*`, who and when). The database enforces it on every path (listing published, weekly time added, sign-ups opened, dates changed, license cleared). Coach clearance (below) already uses the camp standard. | Don't run anything 4+ days in a row. If that ever changes, get the DSHS license **before** advertising, then enter its number; add the camp's emergency plan and floodplain notice to parents (HB 1/SB 1, 2025). |
| **School district contractors** — Educ. Code §22.0834 | A contractor's employees with continuing duties and direct contact with students on a district campus need a **fingerprint-based** national criminal history check through DPS. | The coach record has a "fingerprint-based" box alongside the background check. | Programs run with the **approval of each host district and charter school** (owner, 5 Oct 2026). Keep each approval on file and meet that host's clearance requirements — fingerprint every coach through the DPS FACT clearinghouse wherever the host treats you as a contractor. |
| **Staff safeguarding (best practice; Safe Sport for NGB members)** — 36 U.S.C. 220530; 34 U.S.C. 20341 | The federal Safe Sport Act binds organizations sanctioned by a national governing body or in interstate competition. Rising Stars has **no NGB affiliation** (owner, 5 Oct 2026), so it **does not apply**. Insurers and host schools expect background checks, training, CPR and a code of conduct regardless. | `lib/coach-clearance.ts`: **cleared** = background check (with sex-offender registry) within 12 months, abuse-prevention training in date (2 years unless the certificate says), CPR/First Aid in date, signed code of conduct. Shown as a badge on **Coaches**, a red banner for scheduled coaches who aren't cleared, "— not cleared" in the weekly-slot and practice coach pickers with a warning, and **Compliance → Coach checks** (expiring within 30 days). `getCoachClearance(coachId)` + `<CoachClearanceBadge>` for the program-creation flow. | Enter every coach's checks. Don't schedule anyone "Not cleared". If you ever join an NGB (e.g. USA Basketball) or enter interstate competition, the Safe Sport Act's training and reporting rules start to apply. |
| **Concussion** — CDC HEADS UP; Educ. Code ch. 38 subch. D (Natasha's Law) as the model | Natasha's Law binds school districts, not private programs. The standard of care (CDC, and what schools and insurers expect): remove from play, written clearance from a licensed health care professional before returning. | An incident with **possible concussion** puts the child on hold: the database refuses to mark them present/late at any practice on or after the incident (trigger on `ops.attendance`, `20261006000150`), the dashboard and coach register show "Sitting out", and the coach register refuses to save them as here. Recording the clearance requires who signed it. | Keep the signed clearance note (note where in the incident). Train coaches on CDC HEADS UP. |
| **ADA Title III** — 42 U.S.C. 12181 et seq.; 28 CFR 36.302 | Private programs are public accommodations: reasonable modifications for children with disabilities (e.g. diabetes care, allergy plans, a support person). DOJ says public-facing websites should be accessible (2022 guidance). | Medical notes carry what coaches need to know, to the assigned coach. CoachOS's own UI uses labelled controls, 44px tap targets and ARIA tabs (existing tests). | Have a written process for accommodation requests; don't refuse a child because of a disability without counsel. Keep the website accessible (WCAG 2.1 AA). |
| **IRS record keeping** — 26 CFR 1.6001-1; IRS Pub 583 | Keep income records **3 years** (6 if income under-reported by 25%+, 7 for bad-debt claims), employment-tax records **4 years**; 1099-NEC for contractors. | Invoices and payments are **never** deleted by erasure or retention — only free-text notes and the names they'd link to are removed. Payment history doesn't cascade (existing ADR). | Keep 7 years of books to be safe. Keep coach payment records for 1099s **[CONFIRM]** the 2026 threshold with your accountant. |
| **Limitation periods for injuries to minors** — Civ. Prac. & Rem. Code §16.001, §16.003 | A child's 2-year personal-injury clock only starts at 18, so a claim can come until they turn 20 (longer for abuse, §16.0045). | Incidents are excluded from retention and erasure (legal-claims exemption, TDPSA §541.201(a)(3)); `students.id` is `ON DELETE RESTRICT` from incidents. | Keep signed waivers and incident paperwork until the child is 20 plus a margin. |

## How long we keep things (retention policy)

Set in `apps/web/src/lib/retention.ts`; enforced nightly by `/api/cron/retention`
→ `ops.run_retention` (`20261006000170`). Every run, dry or real, writes an
audit row with its counts.

| Data | Kept for | Then |
|---|---|---|
| Website inquiries (questions, trials, waitlist interest) | 24 months from receipt | Name, phone, email, message, details and attribution removed; the row (kind, dates) stays for counts |
| Registrations that never became a place (declined, cancelled, waitlist never cleared) | 24 months since last change | Child and parent details, DOB, medical notes removed; amount and status stay |
| A child's medical note | 12 months after their last active place (or last attendance) | Removed from the child and their registrations |
| Closed privacy requests | 36 months | Requester's contact removed; the request, dates and outcome stay |
| Invoices, payments, credits | Indefinitely (≥7 years) | Never touched |
| Incident reports | Until the child is at least 20 | Never touched by the job |
| Audit log, consent history | Indefinitely | Append-only; contain ids, not personal details |

The job **only counts** until `RETENTION_ENABLED=true` is set in Vercel. The
owner can see tonight's counts on **Compliance → Data kept**.

## Who can see a child's medical note and date of birth

* **Admins** (accounts with `app_metadata.role = 'admin'`) through the
  dashboard. Every `ops` table's RLS requires `ops.is_admin()`; a signed-in
  non-admin and the anon key get nothing (`tests/integration/child-safety.test.ts`,
  `security.test.ts`, `admins-only.test.ts`). Pages that render notes log a
  `medical.view` audit row naming the children (family page, students page,
  student detail, registrations page).
* **The coach assigned to the practice**, through its passcode-protected
  register link. The link records the coach it was issued to; notes are shown
  only when that coach runs the practice or the program's weekly slot. Anyone
  else holding a link sees only "has a medical note — ask the Boss". Each
  register opening that shows notes writes an audit row. Dates of birth never
  reach the register.

## Data-breach response runbook

Start the clock the moment a breach is **suspected** — a lost phone signed in
to CoachOS, a leaked service-role key, a stranger who can see a family's page,
an email sent to the wrong parent with another child's details.

1. **Contain (first hour).**
   * Rotate what might be exposed: Supabase service-role/anon keys and JWT
     secret (Supabase → Settings → API), `CRON_SECRET`, `RESEND_API_KEY`,
     Stripe keys; redeploy on Vercel.
   * Remove access: Settings → Access in CoachOS; sign out all sessions in
     Supabase Auth; revoke coach register links (Schedule).
   * A family's payment link shared too widely: reset it (Help → "A family's
     link was shared too widely").
2. **Preserve evidence.** Don't delete anything. Export the Supabase logs,
   Vercel logs, and `ops.audit_log` rows for the period
   (`select * from ops.audit_log where at > '…' order by at`).
3. **Work out who and what (days 1–5).** Which families, which fields (names?
   phones? DOB? medical notes = "sensitive personal information" under
   §521.002). Count affected **Texas residents**.
4. **Decide, with counsel.** Call the Texas attorney and the insurer
   (cyber/general liability) before notifying.
5. **Notify.**
   * **Individuals** (parents, on behalf of their children): without
     unreasonable delay and **no later than 60 days** after determining the
     breach (§521.053(b)). Say what happened, what data, what we've done, what
     they can do, and how to reach us. Email from CoachOS or by letter.
   * **Texas Attorney General** if **250 or more** Texans: as soon as
     practicable and **within 30 days**, using the form at
     <https://www.texasattorneygeneral.gov/consumer-protection/data-breach-reporting>
     (§521.053(i)).
   * **Credit bureaus** (Equifax, Experian, TransUnion) if more than 10,000
     people are notified at once (§521.053(h)).
   * Residents of other states: their own laws apply **[CONFIRM]** with counsel.
6. **Record** the incident, decisions and notices (date, who, how) and keep
   them with the audit export.
7. **Fix and review** the cause; add a test that would have caught it.

## Owner actions — the checklist

1. Have a **Texas attorney** review the privacy policy, terms, registration
   waiver, photo release, SMS consent wording, code of conduct, and this page.
2. **Settings → Mailing Address (for newsletters)**: fill in a postal address or PO box. [CONFIRM]
3. **Vercel**: set `RETENTION_ENABLED=true` once you've looked at the first
   dry-run counts on Compliance → Data kept.
4. Enter every coach's background check (with sex-offender registry), training,
   CPR/First Aid and code of conduct on **Coaches**.
5. Keep each host district's / charter school's approval on file and meet its
   coach-clearance rules (fingerprinting where it treats you as a contractor).
6. Record every STOP, every written yes/no to promotional texts, and every
   photo-release change on the family page the day you hear it. Send
   promotions only from Compose with **This is a promotion** ticked.
7. Don't schedule or advertise anything that meets 4+ days in a row unless
   you first hold a DSHS youth camp license.
8. Keep Supabase, Vercel, Stripe, Resend and the Gmail that receives Zelle
   emails on 2-factor authentication.
9. Brief coaches on mandatory reporting (1-800-252-5400), concussion (sit out
   until cleared in writing), and not photographing children marked "No
   photos".

## Where it lives

| Piece | Code |
|---|---|
| Consents stored verbatim, follow the family, history | `supabase/migrations/20261006000100_consents.sql`, `lib/actions/consents.ts`, `components/family-consents.tsx` |
| Audit log | `20261006000110_audit_log.sql`, `lib/audit.ts` |
| Privacy requests, export, erasure; contact-form consents stored verbatim | `20261006000120_privacy_requests.sql`, `lib/privacy.ts`, `lib/actions/privacy.ts` |
| Texts and email consent, suppression, unsubscribe | `20261006000130_messaging_consent.sql`, `lib/marketing-email.ts`, `lib/sms-keywords.ts`, `app/api/unsubscribe/route.ts` |
| Promotional-text consent (`sms_promotional`), Texas quiet hours | `20261007000100_promotional_texts.sql`, `lib/quiet-hours.ts`, `lib/actions/messages.ts`, `lib/actions/outbox.ts` |
| Youth-camp guard | `20261007000200_youth_camp_guard.sql`, `lib/youth-camp.ts`, `lib/new-program.ts`, `components/schedule-template-form-dialog.tsx` |
| Coach clearance | `20261006000140_coach_clearance.sql`, `lib/coach-clearance.ts`, `lib/queries/coach-clearance.ts`, `components/coach-clearance-badge.tsx` |
| Incidents, concussion holds | `20261006000150_incidents.sql`, `lib/actions/incidents.ts` |
| Medical-note access on the coach register | `20261006000160_medical_access.sql` |
| Retention | `20261006000170_retention.sql`, `lib/retention.ts`, `app/api/cron/retention/route.ts` |
| Owner's screen | `/compliance` (`components/compliance-page-client.tsx`) |
| Tests | `tests/integration/compliance-consents`, `messaging-compliance`, `promotional-texts`, `quiet-hours`, `youth-camp`, `privacy-requests`, `retention`, `child-safety` |
