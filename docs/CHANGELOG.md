# Changelog

All notable changes to CoachOS.

## [Unreleased]

### Added
- Comprehensive project documentation (CLAUDE.md, KNOWLEDGE_BASE.md, docs/)

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
- Invoice status lifecycle: pending -> paid / overdue / waived
- Payment recording with method (cash, Zelle, Venmo) and reference
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
