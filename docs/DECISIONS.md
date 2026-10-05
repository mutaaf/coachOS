# Architecture Decision Records

This document captures key decisions made during development, their context, and rationale.

---

## ADR-001: Turborepo Monorepo Structure

### Status
Accepted

### Context
The project has two separate runtime applications (Next.js web dashboard and a Node.js WhatsApp bot) plus shared code. We needed a way to manage them together while keeping clear boundaries.

### Decision
Use Turborepo with npm workspaces, organized as `apps/web`, `apps/whatsapp-bot`, and `packages/shared`.

### Rationale
1. Both apps share the same Supabase database and need consistent types/utilities
2. The `shared` package (template engine) is used by both the web cron job and the WhatsApp bot
3. Turborepo provides parallel builds and caching with minimal configuration
4. npm workspaces are native — no additional package manager needed

### Implementation
```json
// package.json (root)
{
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "turbo dev --filter=web",
    "dev:bot": "turbo dev --filter=whatsapp-bot"
  }
}
```

### Consequences
- Shared code changes are immediately available to both apps during development
- Each app can be deployed independently (web to Vercel, bot to Railway)
- Root `npm install` manages all dependencies

---

## ADR-002: Supabase Without ORM

### Status
Accepted

### Context
The application needs a PostgreSQL database with authentication, real-time capabilities, and a generous free tier for initial development.

### Decision
Use Supabase directly via `@supabase/supabase-js` with manually typed queries. No ORM (Prisma, Drizzle, etc.).

### Rationale
1. Supabase provides database + auth + storage + edge functions in one service
2. The query API (`.from().select().eq()`) is already ergonomic for this project's needs
3. Avoiding an ORM keeps the dependency footprint small and avoids schema sync issues
4. Manual types in `types/database.ts` give full control over the shape of joined data
5. Server-side queries use cookie-based auth via `@supabase/ssr` for secure SSR

### Implementation
```typescript
// Server queries throw on error
const { data, error } = await supabase.from("schools").select("*").order("name");
if (error) throw error;

// Server actions return error objects
if (error) return { error: error.message };
```

### Consequences
- Type definitions must be manually updated when schema changes (no auto-generation)
- No migration tooling beyond raw SQL files in `supabase/migrations/`
- Very fast queries with no ORM overhead
- Full control over join shapes and query optimization

---

## ADR-003: Next.js Server Actions for Mutations

### Status
Accepted

### Context
The web app needs a way to handle form submissions and data mutations from the dashboard.

### Decision
Use Next.js Server Actions (`"use server"` functions) that accept `FormData` and return `{ data } | { error }`.

### Rationale
1. Server Actions eliminate the need for API routes for mutations
2. FormData is the native browser form submission format
3. The `{ data } | { error }` return pattern allows client components to show toasts without try/catch
4. `revalidatePath()` automatically refreshes server component data after mutations

### Implementation
```typescript
// Server action
"use server";
export async function createSchool(formData: FormData) {
  // validate → insert → revalidatePath → return { data }
}

// Client usage
const result = await createSchool(formData);
if (result.error) toast.error(result.error);
else toast.success("School created");
```

### Consequences
- All mutations are server-side with no client-side Supabase writes
- FormData extraction requires casting (`formData.get("name") as string`)
- Bulk import actions break the FormData convention by accepting typed arrays directly

---

## ADR-004: WhatsApp via whatsapp-web.js (Headless Browser)

### Status
Accepted

### Context
The business communicates with parents primarily through WhatsApp. We need programmatic message sending without the official WhatsApp Business API (which requires business verification and has per-message costs).

### Decision
Use `whatsapp-web.js` which automates WhatsApp Web via Puppeteer (headless Chromium).

### Rationale
1. No WhatsApp Business API approval or per-message fees required
2. Sends messages from the owner's actual WhatsApp number (familiar to parents)
3. QR code authentication mirrors the normal WhatsApp Web flow
4. Supports the exact same message types as WhatsApp Web

### Implementation
The bot runs as a standalone Node.js service with Chromium, stores connection state in the `whatsapp_state` table, and polls the `message_queue` table for pending messages.

### Consequences
- Requires a persistent server with Chromium (Railway Docker container, ~$5/month)
- Must re-scan QR code if the session expires (handled via wizard UI)
- Dependent on WhatsApp Web's internal protocol (potential breaking changes)
- Cannot use WhatsApp-specific Business API features (catalogs, buttons, etc.)

---

## ADR-005: Separate Bot Deployment on Railway

### Status
Accepted

### Context
The WhatsApp bot needs Chromium and a persistent process. Vercel's serverless functions have 10-second timeout limits and no persistent state.

### Decision
Deploy the WhatsApp bot as a Docker container on Railway, separate from the Vercel-hosted web app.

### Rationale
1. Vercel cannot run long-lived processes or headless browsers
2. Railway supports Docker with persistent containers and custom health checks
3. The bot only needs Supabase credentials — no tight coupling to the web app
4. Railway's free tier covers low-usage bots; paid tier is ~$5/month

### Implementation
```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```
`railway.json` configures Docker build and `/health` healthcheck endpoint.

### Consequences
- Two separate deployments to manage (web on Vercel, bot on Railway)
- Bot URL must be configured in the web app's settings (via `whatsapp_bot_url` config)
- Health endpoint enables Railway auto-restart and web app connection verification

---

## ADR-006: shadcn/ui Component Library

### Status
Accepted

### Context
The dashboard needs consistent, accessible UI components without the overhead of a full component framework.

### Decision
Use shadcn/ui — copy-paste components built on Radix UI primitives, styled with Tailwind CSS and class-variance-authority (CVA).

### Rationale
1. Components are owned code (copied into `components/ui/`), not a dependency
2. Full control over styling and behavior — no version lock-in
3. Built on Radix UI for accessibility (keyboard nav, ARIA attributes)
4. CVA provides type-safe variant props
5. Tailwind integration is native — no CSS-in-JS overhead

### Implementation
10 components in `src/components/ui/`: Badge, Button, Card, Dialog, Input, Label, Select, Switch, Tabs, Textarea.

### Consequences
- New components must be manually copied from shadcn/ui docs
- Consistent design language across the entire dashboard
- Easy to customize — just edit the component file directly

---

## ADR-007: Bulk Import with Smart Paste Parser

### Status
Accepted

### Context
The business owner has existing data in WhatsApp contacts and needs to add many schools, students, and parents at once instead of one-by-one through form dialogs.

### Decision
Build a bulk import system with two input modes: a spreadsheet-like Quick Entry grid and a Paste & Import mode that smart-parses WhatsApp contact data.

### Rationale
1. Quick Entry grid (tab between cells) is faster than opening dialogs one by one
2. Parents' contact info typically exists in WhatsApp — copy-paste is the natural flow
3. Smart parser handles messy formats: "John Smith 555-123-4567", phone-first, CSV, etc.
4. Editable review table after parsing lets users correct before committing
5. Bulk server actions use batch Supabase inserts for efficiency

### Implementation
- `bulk-import.ts`: Server actions accepting typed arrays, batch insert, return `{ created, errors[] }`
- `quick-entry-grid.tsx`: Table of `<Input>` fields, 5 empty rows, "Add 5 More", validation
- `paste-import.tsx`: Textarea → parser → editable table → import
- `bulk-import-dialog.tsx`: Tabs container with column configs per entity type

### Consequences
- Bulk actions break the FormData convention (accept JSON arrays instead)
- Parser handles common formats but may need tuning for edge cases
- No duplicate detection — importing the same data twice creates duplicates

---

## ADR-008: Optional Stripe Integration via Config Table

### Status
Accepted

### Context
Some parents prefer online payments over cash/Zelle/Venmo. The business owner needed a way to generate payment links and send them via WhatsApp, but Stripe shouldn't be mandatory since many parents still pay in person.

### Decision
Add Stripe as an optional integration controlled by config table entries (`stripe_enabled`, `stripe_secret_key`). When enabled, invoice generation auto-creates Stripe invoices and a "Send Link" button queues WhatsApp messages with the hosted invoice URL.

### Rationale
1. Config-driven toggle avoids hard dependency — Stripe can be turned on/off without code changes
2. Stripe's hosted invoice page handles payment collection, PCI compliance, and receipts
3. Sending links via WhatsApp (the existing communication channel) is natural for parents
4. `getOrCreateStripeCustomer()` lazily creates Stripe customers only when needed, storing `stripe_customer_id` on the parent row

### Implementation
- `actions/stripe.ts`: `getStripeClient()` reads config, returns null if disabled
- `createStripeInvoice()`: creates customer → invoice → line item → finalize → save URL
- `generateMonthlyInvoices()` in `payments.ts` calls `createStripeInvoicesForMonth()` after batch creation
- `sendStripePaymentLink()` queues a WhatsApp message with the payment URL

### Consequences
- Stripe secret key is stored in the config table (database), not environment variables
- Parents without email can still receive Stripe links via WhatsApp (phone-based)
- Manual payments (cash/Zelle/Venmo) and Stripe payments coexist on the same invoice
- No Stripe webhook handling yet — payment status sync is manual

---

## ADR-009: Full CRUD for Invoices and Payments with Auto-Recalculation

### Status
Accepted

### Context
Invoices and payments were initially write-once: invoices could only be generated/waived, and payments could only be recorded. The business owner needed to correct mistakes (wrong amounts, wrong methods) and clean up test data.

### Decision
Add full edit and delete capabilities for both invoices and payments, with automatic invoice status recalculation via a shared `recalculateInvoiceStatus()` helper.

### Rationale
1. Data entry mistakes are inevitable — the owner needs to fix them without database access
2. Automatic status recalculation prevents stale statuses when payments are edited/deleted
3. Delete guard on invoices (must delete payments first) prevents orphaned payment records
4. Client-side filtering (student, parent, program, method) helps trace payments in growing datasets

### Implementation
- `recalculateInvoiceStatus(supabase, invoiceId)`: sums payments, compares to invoice amount, checks due date, skips waived
- `updateInvoice/deleteInvoice`: standard CRUD with guard on delete
- `updatePayment/deletePayment`: CRUD + trigger recalculation on linked invoice
- `invoice-form-dialog.tsx`: edit dialog with read-only context (student/parent/program) and editable fields
- `record-payment-dialog.tsx`: optional `payment` prop enables edit mode
- `payments-page-client.tsx`: Pencil/Trash2 buttons on every row, `<Select>` filter dropdowns

### Consequences
- Invoice status is derived from payment totals — manual status overrides (e.g., setting to "paid" without full payment) are possible but may be recalculated on next payment change
- Deleting a payment may change an invoice from "paid" back to "pending" or "overdue"
- Filter dropdowns only appear when there are 2+ unique values (avoids clutter for small datasets)

---

## ADR-010: Autopay through Stripe, Zelle matched from bank emails

### Status
Accepted

### Context
Every month the owner posted a payment reminder in each session's WhatsApp group,
then read the replies — "sent via zelle", "can I get an invoice?" — and recorded
each payment by hand. Most families pay by Zelle; a few want a card.

### Decision
Two paths, both ending in the same invoices and payments tables:
1. **Autopay** — a parent saves a bank account or card once, through Stripe
   Checkout in setup mode, from a private page at `/pay/{token}`. The daily cron
   charges each invoice on its due date with an off-session PaymentIntent.
2. **Zelle matching** — the bank's notification emails are posted to
   `/api/inbound/zelle` by a Google Apps Script running in the owner's Gmail, and
   matched to families by sender name and amount.

### Rationale
1. Zelle has no API. The bank email is the only machine-readable record, and an
   Apps Script needs no DNS, mail provider, or forwarding verification — it runs
   inside the account that already receives the emails
2. A bank debit costs about 0.8% against about 3% for a card, so it is offered
   first and free; the card fee is a setting, disclosed before the parent picks
3. Autopay keeps Stripe's own invoices out of it: one PaymentIntent per invoice,
   idempotency-keyed on the invoice and the saved payment method, so a retry or
   an overlapping run cannot charge twice
4. Automatic Zelle matching is deliberately narrow — one family, exact amount,
   oldest invoices first. A payment on the wrong child is worse than one waiting
   a day for a tap

### Implementation
- `lib/autopay.ts`, `lib/zelle.ts`, `lib/invoice-status.ts` are plain server
  modules, **not** `"use server"`: every export of an actions module is a public
  endpoint, and these charge cards
- `lib/actions/pay-page.ts` holds the parent's three actions, each scoped by the
  page token
- `invoices.status = 'processing'` while a bank debit settles; the claim that
  moves an invoice there is also what stops two cron runs charging it
- `payments.external_id` (unique) and `zelle_receipts.message_id` (unique) make
  webhook redelivery and the script's re-sending harmless

### Consequences
- The Stripe webhook must subscribe to `checkout.session.completed`,
  `setup_intent.succeeded`, `payment_intent.succeeded` and
  `payment_intent.payment_failed` in addition to the invoice events
- A family's page shows children's first names and amounts to anyone with the
  link. The token is 144 random bits; no last names, contacts or notes are shown
- Parsing depends on banks' email wording. Unreadable emails are kept and shown
  rather than dropped, so a format change is visible, not silent


---

## ADR-011: One save for a program at many schools; site photos in CoachOS

### Status
Accepted

### Context
Putting a program on at two schools and on the website took about 40 taps over
10 screens (docs/ADMIN_FLOWS.md), and every step saved on its own, so a failure
left a program half-made. The website's pictures were AI cartoons baked into its
code; changing one needed a deploy.

### Decision
1. A New program page builds one draft (`lib/new-program.ts`, plain and tested)
   and saves it with one database function, `ops.create_program_sessions(jsonb)`,
   which makes or reuses the program, season and schools, a session per school
   with its weekly times and coach, and the website listing and card photo — in
   one transaction. Service role only, called after the admin check.
2. Site photos live in `ops.site_media` + `ops.site_media_placements`, exposed
   through `public.site_media` (contract v1.2). Files go browser → signed upload
   URL → server, which re-encodes with `sharp` (upright, metadata stripped) and
   makes WebP sizes. The bucket is public-read; a restrictive storage policy
   keeps anon and signed-in users from writing it.
3. A photo marked as showing recognizable children cannot be published until a
   photo release is confirmed — checked in the action, by a table constraint,
   and again in the view.

### Rationale
- A PL/pgSQL function is the only way to get all-or-nothing across a dozen
  inserts through PostgREST; the existing per-step actions stay for editing.
- Uploading straight to storage avoids Vercel's 4.5 MB request limit for phone
  photos; re-encoding on the server removes GPS from photos of children.
- Three layers for the release rule, because a photo of a child published by
  mistake can't be taken back from people who saw it.

### Consequences
- `site_offerings.image_url` prefers a card's own photo, then the listing's and
  program's pictures, then the sport's photo — so assigning a card photo replaces
  an old cartoon without editing the listing.
- `sharp` is a dependency of `web`. If it fails to load, photos are stored as
  uploaded with no sizes and the page says so.
