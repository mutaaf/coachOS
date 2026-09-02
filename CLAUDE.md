# CoachOS - AI Knowledge Base

> All-in-one management platform for youth sports businesses — schools, students, payments, scheduling, and WhatsApp messaging.

**See Also:**
- [KNOWLEDGE_BASE.md](./KNOWLEDGE_BASE.md) - Detailed technical reference
- [docs/DECISIONS.md](./docs/DECISIONS.md) - Architecture decision records
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) - Version history and changes

## Project Overview

### What This Is
CoachOS is a full-stack management platform for youth sports program owners. It handles the entire workflow: onboarding partner schools, enrolling students, linking parents, scheduling sessions, tracking attendance, managing payments/invoices, and sending automated WhatsApp reminders. The web dashboard provides a single pane of glass for the business owner (referred to as "Boss" in the UI).

### Why It Exists
- Managing youth sports programs across multiple schools involves tracking hundreds of students, parents, payments, and sessions
- Communication with parents happens primarily through WhatsApp (not email) in the target market
- Existing tools are either too generic (spreadsheets) or too complex (enterprise SaaS)
- The owner needs one system that ties schools, students, payments, and messaging together

### Who It's For
- Primary user: the business owner ("Boss") who runs youth sports programs at multiple schools
- Secondary: parents who receive WhatsApp reminders about practice and payments

---

## Architecture Overview

### Tech Stack
| Layer | Technology | Version |
|-------|------------|---------|
| Monorepo | Turborepo | ^2.3.0 |
| Web Framework | Next.js (App Router) | ^14.2.35 |
| UI | React + shadcn/ui + Tailwind CSS | React ^18.3, TW ^3.4.16 |
| Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.47.10 |
| Auth | Supabase Auth (email/password) | @supabase/ssr ^0.5.2 |
| Payments | Stripe (optional) | stripe ^20.3.1 |
| WhatsApp Bot | whatsapp-web.js + Puppeteer | ^1.26.0 |
| Icons | lucide-react | ^0.468.0 |
| Toasts | sonner | ^1.7.1 |
| Dates | date-fns | ^4.1.0 |
| Deployment (web) | Vercel | vercel.json |
| Deployment (bot) | Railway (Docker) | railway.json |

### Key Design Decisions
0. **Two schemas in one database** — this Supabase project (`anzzhodsulqygshhptzt`)
   also backs the marketing site at risingstars.training. The site's CMS tables
   live in `public` and include their own `programs` table; every operational
   table lives in `ops`. All Supabase clients set `db: { schema: "ops" }`, so
   `.from("programs")` resolves to `ops.programs`. `anon` has no USAGE on `ops`,
   which is what keeps student and parent data off the public API — the public
   registration page reaches it only through server actions holding the service
   role.
1. **Supabase direct queries, no ORM** — simple `.from().select()` pattern, types defined manually in `types/database.ts`
2. **Server Actions for mutations** — all writes go through `"use server"` functions accepting FormData, returning `{ data } | { error }`
3. **Server queries for reads** — separate `lib/queries/` modules that throw on error, called from server components
4. **Client components for interactivity** — `*-page-client.tsx` pattern: server page fetches data, passes to client component
5. **Shared template engine** — `packages/shared` exports `renderTemplate()` for mustache-style message templating, used by both web cron and bot
6. **WhatsApp over email** — primary communication channel is WhatsApp via whatsapp-web.js headless browser
7. **Stripe is optional** — enabled via config table (`stripe_enabled`, `stripe_secret_key`). When enabled, invoice generation auto-creates Stripe invoices and payment links can be sent via WhatsApp

---

## Directory Structure

```
coachOS/
├── apps/
│   ├── web/                          # Next.js 14 dashboard
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/login/     # Login page
│   │   │   │   ├── (dashboard)/      # Protected routes (sidebar layout)
│   │   │   │   │   ├── dashboard/    # Home dashboard
│   │   │   │   │   ├── schools/      # Schools + [schoolId] detail
│   │   │   │   │   ├── students/     # Students & parents
│   │   │   │   │   ├── schedule/     # Sessions & attendance
│   │   │   │   │   ├── payments/     # Invoices & payments
│   │   │   │   │   ├── messaging/    # Message templates & queue
│   │   │   │   │   ├── marketing/    # Leads pipeline
│   │   │   │   │   └── settings/     # Config + WhatsApp wizard
│   │   │   │   └── api/cron/         # Vercel cron jobs
│   │   │   ├── components/
│   │   │   │   ├── ui/               # shadcn/ui primitives
│   │   │   │   ├── *-page-client.tsx # Interactive page components (7)
│   │   │   │   ├── *-form-dialog.tsx # Modal forms + dialogs (13)
│   │   │   │   ├── bulk-import-*.tsx # Bulk import system
│   │   │   │   └── whatsapp-setup-wizard.tsx
│   │   │   ├── lib/
│   │   │   │   ├── actions/          # Server actions (11 modules)
│   │   │   │   ├── queries/          # Server queries (8 modules)
│   │   │   │   ├── supabase/         # Client + server Supabase setup
│   │   │   │   └── utils.ts          # cn(), formatCurrency(), formatPhone()
│   │   │   └── types/database.ts     # All TypeScript types
│   │   ├── middleware.ts             # Auth redirect middleware
│   │   └── vercel.json              # Cron schedule config
│   └── whatsapp-bot/                 # Standalone WhatsApp service
│       ├── src/
│       │   ├── index.ts              # Entry point + health server
│       │   ├── client.ts             # WhatsApp Web.js wrapper
│       │   ├── health.ts             # HTTP /health endpoint
│       │   └── services/message-queue.ts
│       ├── Dockerfile                # Chromium + Node.js
│       └── railway.json              # Railway deploy config
├── packages/
│   └── shared/                       # Shared utilities
│       └── src/template-engine.ts    # {{variable}} message templating
├── supabase/
│   └── migrations/                   # SQL migration files
├── package.json                      # Workspace root
└── turbo.json                        # Turborepo config
```

---

## Key Files Reference

### Database Types (`apps/web/src/types/database.ts`)
All 18 table types + joined types (StudentWithParents, EnrollmentWithDetails, etc.). This is the single source of truth for data shapes — update here when schema changes.

### Server Actions (`apps/web/src/lib/actions/`)
Pattern: `"use server"` → accept FormData → validate → Supabase insert/update → revalidatePath → return `{ data }` or `{ error }`. Key modules: `schools.ts`, `students.ts`, `payments.ts`, `stripe.ts`, `messages.ts`, `bulk-import.ts`.

### Supabase Setup (`apps/web/src/lib/supabase/`)
- `server.ts` — creates server client with cookie-based auth (used in server components and actions)
- `client.ts` — creates browser client (used in client components)
- `middleware.ts` — auth check, redirects unauthenticated to `/login`

### Dashboard Layout (`apps/web/src/app/(dashboard)/layout.tsx`)
Client component with responsive sidebar navigation. All 8 nav items defined in `navigation[]` array.

### WhatsApp Client (`apps/whatsapp-bot/src/client.ts`)
Wraps whatsapp-web.js. Handles QR code generation (saves base64 to `whatsapp_state` table), connection lifecycle, message sending with US phone number formatting.

### Daily Reminders Cron (`apps/web/src/app/api/cron/daily-reminders/route.ts`)
Runs daily at 6 PM (Vercel cron). Sends practice reminders for tomorrow's sessions and payment reminders for overdue invoices. Uses shared `renderTemplate()`.

---

## Common Tasks

### Running the Project
```bash
npm install          # Install all workspace dependencies
npm run dev:web      # Start Next.js dev server (http://localhost:3050)
npm run dev:bot      # Start WhatsApp bot dev server
npm run dev          # Start everything via Turborepo
```

### Building
```bash
npm run build        # Build all workspaces
cd apps/web && npx next build  # Build web only
```

### Adding a New Server Action
1. Create or edit a file in `apps/web/src/lib/actions/`
2. Add `"use server"` at the top
3. Accept `FormData`, validate inputs, call Supabase, `revalidatePath()`
4. Return `{ data }` on success or `{ error: string }` on failure

### Adding a New Page
1. Create `apps/web/src/app/(dashboard)/your-page/page.tsx` (server component)
2. Fetch data using queries from `lib/queries/`
3. Create `components/your-page-client.tsx` with `"use client"`
4. Add navigation entry in `app/(dashboard)/layout.tsx` navigation array

### Running Database Migrations
```bash
npm run db:migrate   # Pushes migrations to the hosted project
```

### Running Tests
```bash
npm run db:start     # Local Supabase stack (Docker via Colima)
npm run test         # Integration tests
npm run test:e2e     # End-to-end tests
npm run test:all     # Everything, from cold
```

---

## Known Considerations

1. **No ORM** — all queries are raw Supabase client calls. Types are manually maintained in `types/database.ts`. When adding columns, update both the migration AND the type file.
2. **FormData convention** — server actions accept `FormData`, not JSON objects. Client components create forms or manually construct FormData.
3. **Bulk import uses JSON** — unlike single-record actions that use FormData, bulk import actions accept typed arrays directly.
4. **WhatsApp bot requires Chromium** — the bot uses Puppeteer with a real Chromium instance. Local dev needs Chrome/Chromium installed. Docker image bundles chromium-slim.
5. **Polling, not realtime** — the WhatsApp setup wizard polls `whatsapp_state` every 3 seconds. The app does not use Supabase realtime subscriptions.
6. **Tests run against a local Supabase stack in Docker, never the hosted project** —
   `npm run db:start` then `npm run test` (Vitest integration) and
   `npm run test:e2e` (Playwright). The helpers refuse to run if the API URL is
   not on localhost. See [docs/TESTING.md](./docs/TESTING.md).
7. **Owner terminology** — the UI calls the user "Boss" (not "Coach"). Keep this consistent.
8. **US phone formatting** — phone numbers default to US (+1) when only 10 digits are provided.
9. **Payments have full CRUD** — invoices and payments can be edited and deleted. Deleting an invoice requires deleting its payments first. Payment changes trigger automatic invoice status recalculation via `recalculateInvoiceStatus()`.
10. **Stripe config-driven** — Stripe is toggled via `config` table entries (`stripe_enabled`, `stripe_secret_key`). When enabled, `generateMonthlyInvoices` auto-creates Stripe invoices and a "Send Link" button queues WhatsApp messages with the Stripe payment URL.

---

## Environment nuances

`npm run up` brings everything up from cold and is safe to re-run; `npm run down`
stops it. The script enforces each item below, so prefer fixing it there over
fixing it by hand.

**Every one of these cost real time to diagnose. Add to this list whenever
something new bites — that is the point of it.**

| Nuance | Why it matters |
|---|---|
| Node 22+ | supabase-js opens a realtime WebSocket and needs a native one. Node 20 fails at client construction with "native WebSocket not found" — it broke CI while passing locally on 25. |
| Colima, not Docker Desktop | No licence, runs headless. `brew install colima docker`. |
| `credsStore` in `~/.docker/config.json` | A leftover Docker Desktop install leaves `"credsStore": "desktop"`. Without that binary **every** pull fails with an opaque credentials error. |
| `[analytics] enabled = false` | That container mounts `/var/run/docker.sock`, which Colima does not provide. The whole stack fails to start with it on. |
| `ops` in `[api] schemas` | PostgREST will not serve the operational tables otherwise; every query returns `Invalid schema: ops`. Mirrors the production setting. |
| Tests refuse a non-local database | `tests/helpers/db.ts` and both Playwright configs read `supabase status` and throw unless the API URL is localhost. Never weaken this — it is what stops a test run writing into the live rosters. |
| Playwright cannot import `"use server"` modules | They pull in Next internals. Drive the UI, or use the admin client directly; the action's own logic belongs in `tests/integration`. |
| Dates go through `lib/dates.ts` | `toISOString()` converts to UTC first, so from 7pm in Dallas it reports tomorrow. That marked invoices overdue a day early and showed tomorrow's sessions as today's. Never take a date from `new Date().toISOString()`. |
| Server actions return `{ error }`, they do not throw | So `try/catch` around them catches nothing. Call them through `useAction()`, which checks the result, catches the few that do throw, and holds the pending state through the refresh. |
| Supabase clients pass `fetch: no-store` | Next caches fetch responses by URL and `force-dynamic` does not disable it. Without this a page serves its first render forever — seat counts freeze and a parent is offered a place in a full program. |
| Commit author email must match the Vercel account | Vercel blocks deployments it cannot attribute to a team member (`COMMIT_AUTHOR_REQUIRED`), showing only a bare "BLOCKED". Commits must author as `mutaaf.aziz@gmail.com`. |
| Functions run in `sfo1` | The database is in North California. They defaulted to `iad1`, so every query crossed the country. |

---

## Deployment

### Web (Vercel)
- Deployed via Vercel with automatic git deploys
- `vercel.json` configures daily cron at `/api/cron/daily-reminders` (6 PM UTC)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`

### WhatsApp Bot (Railway)
- Deployed via Railway using the Dockerfile
- `railway.json` configures Docker build and `/health` healthcheck
- Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`
- Railway provides `PORT` automatically

---

## Future Roadmap Ideas

1. Supabase realtime subscriptions to replace polling
2. Student attendance reports and analytics dashboard
3. Parent-facing portal for viewing invoices and making payments
4. Multi-user support with role-based access control
5. WhatsApp bot incoming message handling (two-way chat)
6. Export data to CSV/Excel
7. Mobile app or PWA for field use during sessions
