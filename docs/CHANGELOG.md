# Changelog

All notable changes to CoachOS.

## [Unreleased]

### Security
- **Closed public write access to the marketing CMS.** `programs`,
  `partnerships`, and `testimonials` each carried a policy named for
  authenticated users that was in fact `FOR ALL TO public USING (true) WITH
  CHECK (true)`. Since the anon key ships in the marketing site's JavaScript
  bundle, any visitor could rewrite or delete every program listing and
  testimonial on risingstars.training. Public reads are unchanged; writes now
  require a signed-in user, matching what the `content_*` tables already did.

### Added
- Public registration surface for the marketing site: `public.program_availability`
  (aggregate seat counts, no PII) and `public.submit_registration` (creates one
  registration, returns only the outcome), both callable with the anon key while
  `ops` itself stays unreachable
- `public.programs.ops_program_id`, linking a marketing listing to the
  operational program that owns its roster and seat cap
- Test suite: Vitest integration tests and Playwright end-to-end tests, run
  against a local Supabase stack in Docker. See `docs/TESTING.md`
- CMS baseline migration — the seven marketing tables were created through the
  dashboard and existed in no migration, so a fresh database could not be built

### Changed
- Migrations renumbered to Supabase timestamp convention, leaving room to insert
  the CMS baseline ahead of the schema that depends on it

### Added
- `ops` schema — operational tables are namespaced away from the marketing CMS
  that shares this Supabase project, which also owns a `programs` table
  (`supabase/migrations/00000_ops_schema.sql`)
- Coaches — contractor records with pay rate and type, assignable to a weekly
  slot (`schedule_templates.coach_id`) and to the session actually worked
  (`sessions.coach_id`)
- Seat capacity on programs (defaults to 12) plus `registration_open`,
  `public_slug`, `public_description`, and `location` for public listing
- `registrations` table — inbound intake, kept separate from `enrollments` so a
  submission survives being waitlisted or declined
- `ops.submit_registration()` — claims a seat under a row lock so concurrent
  submissions cannot oversell the cap; overflow is waitlisted with a position
- `ops.program_availability` view — aggregate seat counts with no PII
- Public registration page at `/join/[slug]`, exempt from the auth middleware
- Registrations dashboard: capacity bars, waitlist promotion, and conversion of
  a registration into parent/student/enrollment records

### Changed
- All Supabase clients now target the `ops` schema
- Project repointed from the (deleted) Jarvis database to the Rising Stars
  project, which also backs risingstars.training

### Added
- Comprehensive project documentation (CLAUDE.md, KNOWLEDGE_BASE.md, docs/)
- Stripe integration — optional invoice creation and hosted payment links (`actions/stripe.ts`)
- Send Stripe payment link via WhatsApp from invoice row
- Full CRUD for invoices — edit amount, due date, month, status, notes (`invoice-form-dialog.tsx`)
- Full CRUD for payments — edit amount, method, reference, notes (edit mode in `record-payment-dialog.tsx`)
- Delete invoices (with guard: must delete payments first) and delete payments
- Automatic invoice status recalculation (`recalculateInvoiceStatus`) after payment changes
- Invoice tab filters: student, parent, program (dropdown selects)
- Payment history tab filters: student, payment method
- Edit (pencil) and delete (trash) icon buttons on every invoice and payment row

---

## [0.1.0] - Initial Development

### Core Features

#### School Management
- CRUD for partner schools with name, address, contact info (`actions/schools.ts`)
- School detail pages with programs and enrolled students (`schools/[schoolId]/page.tsx`)
- School status tracking: active, inactive, archived
- Bulk import schools via Quick Entry grid or paste (`bulk-import-dialog.tsx`)

#### Student & Parent Management
- Student CRUD with grade, date of birth, medical notes (`actions/students.ts`)
- Parent CRUD with phone, email, payment preferences (cash/Zelle/Venmo)
- Many-to-many student-parent linking with relationship type
- Bulk import students and parents from WhatsApp contacts (`paste-import.tsx`)

#### Program & Enrollment
- Programs tied to schools with season, dates, monthly fee (`actions/programs.ts`)
- Student enrollment and withdrawal tracking (`enrollStudent`, `withdrawEnrollment`)
- Enrollment status: active, withdrawn, completed

#### Scheduling
- Schedule templates for recurring sessions (day of week + times)
- Individual session management with status tracking
- Session cancellation with reason tracking
- Makeup session support

#### Attendance
- Per-student attendance tracking per session
- Status options: present, absent, late, excused
- Check-in timestamp recording

#### Payments & Invoicing
- Monthly invoice generation per student per program
- Invoice status lifecycle: pending -> paid / overdue / waived (auto-recalculated)
- Full CRUD for invoices (edit/delete) and payments (edit/delete)
- Payment recording with method (cash, Zelle, Venmo, Stripe) and reference
- Optional Stripe integration: auto-create Stripe invoices, send payment links via WhatsApp
- Filtering by student, parent, program, and payment method
- Overdue payment alerts on dashboard

#### Messaging
- Message template system with {{variable}} placeholders
- Message queue with retry logic (max 3 attempts)
- Message delivery logging and status tracking
- Automated daily practice reminders (Vercel cron, 6 PM)
- Automated payment reminders for overdue invoices

#### WhatsApp Integration
- WhatsApp bot via whatsapp-web.js with Puppeteer
- QR code authentication flow (saved to `whatsapp_state` table)
- Auto-reconnection on disconnect
- Health endpoint (`/health`) for monitoring
- 4-step setup wizard: Deploy -> Connect -> Scan QR -> Connected
- Railway deployment template with Docker

#### Lead/Marketing Pipeline
- Lead tracking with school name, contact info, estimated students
- Stage-based pipeline: identified -> contacted -> meeting -> proposal -> signed / lost
- Activity logging: notes, calls, emails, meetings, stage changes
- Follow-up date tracking

#### Dashboard
- Stat cards: total schools, active students, monthly revenue, overdue payments
- Upcoming sessions list
- Recent alerts (overdue payments, pending messages)
- Quick action buttons (add student, record payment, send message)
- Personalized greeting: "Good morning/afternoon/evening, Boss"

#### System Configuration
- Key-value config with UI metadata (label, description, field_type)
- Config categories: general, messaging, payments, scheduling
- Field types: toggle, number, text, time, select, textarea
- Batch config updates

### Technical Decisions
- Turborepo monorepo with npm workspaces (ADR-001)
- Supabase PostgreSQL without ORM (ADR-002)
- Next.js Server Actions for mutations (ADR-003)
- whatsapp-web.js for messaging (ADR-004)
- Railway Docker deployment for bot (ADR-005)
- shadcn/ui component library (ADR-006)
- Bulk import with smart paste parser (ADR-007)
- Optional Stripe integration via config table (ADR-008)
- Full CRUD for invoices/payments with auto-recalculation (ADR-009)

---

## Design Philosophy

### Principles
1. **Owner-first** — every feature is built for the single business owner ("Boss"), not a multi-tenant SaaS
2. **WhatsApp-native** — communication happens where parents already are, not via email
3. **Minimal friction** — bulk import, quick entry grids, and smart parsing reduce data entry time
4. **Zero-tech setup** — deployment instructions use friendly language, not Docker/Railway jargon
5. **Server-side by default** — data fetching happens on the server; client components only for interactivity

### UX Decisions
- Sidebar navigation with 8 top-level sections covering the full business workflow
- Form dialogs (modals) for single-record creation/editing
- Toast notifications for success/error feedback
- Responsive layout with mobile hamburger menu
- Card-based dashboard with at-a-glance stats
- Color-coded badges for status indicators

---

## Future Considerations

### Potential Features
- [ ] Unit and integration test suite (vitest)
- [ ] Supabase realtime subscriptions (replace 3-second polling)
- [ ] Student attendance reports and analytics
- [ ] Parent-facing portal for invoice viewing
- [ ] Multi-user support with roles (admin, assistant)
- [ ] Two-way WhatsApp chat (handle incoming messages)
- [ ] CSV/Excel data export
- [ ] Mobile PWA for field use during sessions
- [ ] Duplicate detection during bulk import

### Technical Debt
- [ ] Manual type definitions should sync with Supabase schema (consider code generation)
- [ ] No test coverage — all features are untested
- [ ] Daily reminders cron does N+1 queries for enrollments per session
- [ ] WhatsApp bot depends on unofficial API (whatsapp-web.js) — may break
- [ ] No rate limiting on server actions
- [ ] No input sanitization beyond basic `trim()` in server actions
