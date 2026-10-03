# CoachOS - AI Knowledge Base

> All-in-one management platform for youth sports businesses — schools, students, payments, scheduling, and messaging parents.

**See Also:**
- [KNOWLEDGE_BASE.md](./KNOWLEDGE_BASE.md) - Detailed technical reference
- [docs/DECISIONS.md](./docs/DECISIONS.md) - Architecture decision records
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) - Version history and changes

## Project Overview

### What This Is
CoachOS is a full-stack management platform for youth sports program owners. It handles the entire workflow: onboarding partner schools, enrolling students, linking parents, scheduling sessions, tracking attendance, collecting payments (autopay and automatically-matched Zelle), and messaging parents — WhatsApp from the owner's phone, email sent automatically. The web dashboard provides a single pane of glass for the business owner (referred to as "Boss" in the UI).

### Why It Exists
- Managing youth sports programs across multiple schools involves tracking hundreds of students, parents, payments, and sessions
- Communication with parents happens primarily through WhatsApp (not email) in the target market
- Existing tools are either too generic (spreadsheets) or too complex (enterprise SaaS)
- The owner needs one system that ties schools, students, payments, and messaging together

### Who It's For
- Primary user: the business owner ("Boss") who runs youth sports programs at multiple schools
- Secondary: parents, who get a private payment page, WhatsApp messages from the owner, and emailed receipts

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
| Email | Resend | resend ^6 |
| AI (roster screenshots) | Anthropic SDK, claude-opus-5-5 | @anthropic-ai/sdk |
| Icons | lucide-react | ^0.468.0 |
| Toasts | sonner | ^1.7.1 |
| Dates | date-fns | ^4.1.0 |
| Deployment (web) | Vercel | vercel.json |

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
5. **Shared template engine** — `packages/shared` exports `renderTemplate()` for mustache-style message templating, used by the cron and every queued message
6. **WhatsApp, sent by hand** — parents live on WhatsApp. Messages are queued in `message_queue` and sent from the owner's phone through Messaging → Outbox, where each opens WhatsApp (or SMS) with the text written. There is no bot: an unofficial one (whatsapp-web.js) was built, never deployed, and removed — WhatsApp bans numbers that automate. The official WhatsApp Business API is the path if sending ever needs to be automatic
7. **Getting paid without asking** — families save a bank account or card on their private `/pay/{token}` page and the daily cron charges each invoice on its due date (`lib/autopay.ts`); Zelle payments are recorded from the bank's emails, which a Gmail Apps Script posts to `/api/inbound/zelle` (`lib/zelle.ts`). See ADR-010
8. **Stripe is optional** — enabled via config table (`stripe_enabled`, `stripe_secret_key`). When enabled, invoice generation auto-creates Stripe invoices and payment links land in the Outbox

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
│   │   │   │   │   └── settings/     # Every config value, plus Zelle email setup
│   │   │   │   └── api/cron/         # Vercel cron jobs
│   │   │   ├── components/
│   │   │   │   ├── ui/               # shadcn/ui primitives
│   │   │   │   ├── *-page-client.tsx # Interactive page components (7)
│   │   │   │   ├── *-form-dialog.tsx # Modal forms + dialogs (13)
│   │   │   │   ├── bulk-import-*.tsx # Bulk import system
│   │   │   ├── lib/
│   │   │   │   ├── actions/          # Server actions (11 modules)
│   │   │   │   ├── queries/          # Server queries (8 modules)
│   │   │   │   ├── supabase/         # Client + server Supabase setup
│   │   │   │   └── utils.ts          # cn(), formatCurrency(), formatPhone()
│   │   │   └── types/database.ts     # All TypeScript types
│   │   ├── middleware.ts             # Auth redirect middleware
│   │   └── vercel.json              # Cron schedule config
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
All table types + joined types (StudentWithParents, EnrollmentWithDetails, etc.). This is the single source of truth for data shapes — update here when schema changes.

### Server Actions (`apps/web/src/lib/actions/`)
Pattern: `"use server"` → accept FormData → validate → Supabase insert/update → revalidatePath → return `{ data }` or `{ error }`. Key modules: `schools.ts`, `students.ts`, `payments.ts`, `stripe.ts`, `messages.ts`, `bulk-import.ts`.

### Supabase Setup (`apps/web/src/lib/supabase/`)
- `server.ts` — creates server client with cookie-based auth (used in server components and actions)
- `client.ts` — creates browser client (used in client components)
- `middleware.ts` — auth check, redirects unauthenticated to `/login`

### Dashboard Layout (`apps/web/src/app/(dashboard)/layout.tsx`)
Client component with responsive sidebar navigation. All 8 nav items defined in `navigation[]` array.

### Daily Reminders Cron (`apps/web/src/app/api/cron/daily-reminders/route.ts`)
Runs daily at 6 PM (Vercel cron). Sends practice reminders for tomorrow's sessions and payment reminders for overdue invoices. Uses shared `renderTemplate()`.

---

## Common Tasks

### Running the Project
```bash
npm install          # Install all workspace dependencies
npm run dev:web      # Start Next.js dev server (http://localhost:3050)
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
4. **Settings are data, not code** — every address, number, key and the business name is a row in `config`, edited in Settings with no deploy. Nothing personal is hardcoded or committed; migrations add such settings blank and they are filled in on the live database.
5. **No realtime** — pages read fresh on each request; nothing subscribes to Supabase realtime.
6. **Tests run against a local Supabase stack in Docker, never the hosted project** —
   `npm run db:start` then `npm run test` (Vitest integration) and
   `npm run test:e2e` (Playwright). The helpers refuse to run if the API URL is
   not on localhost. See [docs/TESTING.md](./docs/TESTING.md).
7. **Owner terminology** — the UI calls the user "Boss" (not "Coach"). Keep this consistent.
8. **US phone formatting** — phone numbers default to US (+1) when only 10 digits are provided.
9. **Payments have full CRUD** — invoices and payments can be edited and deleted. Deleting an invoice requires deleting its payments first. Payment changes trigger automatic invoice status recalculation via `recalculateInvoiceStatus()`.
10. **Stripe config-driven** — Stripe is toggled via `config` table entries (`stripe_enabled`, `stripe_secret_key`). When enabled, `generateMonthlyInvoices` auto-creates Stripe invoices and a "Send Link" button puts the Stripe payment URL in the Outbox.

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
| Dates go through `lib/dates.ts` | `toISOString()` converts to UTC first, so from 7pm in Dallas it reports tomorrow. That marked invoices overdue a day early and showed tomorrow's sessions as today's. Never take a date from `new Date().toISOString()`. Stored days go the other way too: `new Date("2026-10-06")` is Monday evening in Dallas — use `formatDateOnly()`/`parseDateOnly()`. `tests/integration/dates.test.ts` scans the source for both. |
| Server actions return `{ error }`, they do not throw | So `try/catch` around them catches nothing. Call them through `useAction()`, which checks the result, catches the few that do throw, and holds the pending state through the refresh. |
| Supabase clients pass `fetch: no-store` | Next caches fetch responses by URL and `force-dynamic` does not disable it. Without this a page serves its first render forever — seat counts freeze and a parent is offered a place in a full program. |
| Commit author email must match the Vercel account | Vercel blocks deployments it cannot attribute to a team member (`COMMIT_AUTHOR_REQUIRED`), showing only a bare "BLOCKED". Commits must author as `mutaaf.aziz@gmail.com`. |
| Auth failures in passcode functions return, never `RAISE` | `RAISE` rolls the transaction back, which would undo the failed-attempt counter and leave the lockout permanently disarmed — a six-digit passcode with no lockout can simply be walked. Caught by a test. |
| `REVOKE ... FROM public` does not revoke from `anon` | Supabase's default privileges grant EXECUTE on new `public` functions directly to `anon`, so the role has to be named explicitly. |
| `supabase stop` misses orphaned stacks | It only stops this project's containers. A stack started from another directory, or orphaned by a `start` over a half-dead one, keeps running and holds the VM open — 20 containers were once left up this way. `npm run down` now sweeps any `supabase_*` container. |
| Autopay and Zelle logic is not `"use server"` | Every export of a `"use server"` module is a public endpoint, callable from any page — including the signed-out `/pay` and `/join` pages. `lib/autopay.ts` charges cards, so it is a plain module reached only from the cron, the webhook, and token-checked actions. |
| Bank debits sit in `processing` for days | The overdue sweeps only move `pending`. Anything new that marks invoices overdue must leave `processing` alone, or families are chased for money already on its way. |
| The Supabase CLI was linked to a different project | `supabase/.temp/project-ref` pointed at an unrelated project ("Jarvis"), so `npm run db:migrate` would have pushed CoachOS tables into it. Run `npx supabase migration list` and check the reference is `anzzhodsulqygshhptzt` before any push. |
| The Anthropic SDK's zod helper wants zod 4 | `zod@3.25` ships v4 under a subpath: import `{ z } from "zod/v4"` where a schema goes to `betaZodOutputFormat`, or it fails to typecheck. |
| Never assert a "pending" invoice for the current month | Invoices fall due on the 1st, so from the 2nd the app correctly calls them overdue. Three tests asserted "pending" and passed only on the day they were written. Use next month, or accept pending-or-overdue. |
| PostgREST can miss a table after `supabase db reset` | Tests fail with "Could not find the table 'ops.x' in the schema cache" though the table exists. `NOTIFY pgrst, 'reload schema';` in the db container fixes it. |
| Email goes out from risingstars.training via Resend | DNS is at Namecheap, which also forwards the domain's mail. Resend's records live on `send`, `rsend`, `resend._domainkey` and `_dmarc` — never touch the root MX or SPF, or forwarding breaks. |
| Every action is guarded, and a test enforces it | All but six actions were callable signed out, holding the service role — anyone with an action id (they ship in page bundles) could read or change rosters and payments. Each now starts with `signedIn()`/`requireSignedIn()`; `tests/integration/action-guards.test.ts` calls every export signed out and fails if one opens a database client. A public action goes in its `PUBLIC` list with the reason. Work the cron needs lives in plain modules (`lib/invoices.ts`, `lib/stripe-invoices.ts`), never behind a guarded action. |
| Signed in is not admin | Accounts are shared with the marketing site. CoachOS, `ops.is_admin()` on every ops policy, and `public.is_admin()` all require `app_metadata.role = 'admin'` (`lib/admin.ts`), which only the service role can set. Sign-up is disabled in the project's auth settings. Grant access from Settings → Access, never by turning sign-up back on. |
| Functions run in `sfo1` | The database is in North California. They defaulted to `iad1`, so every query crossed the country. |

---

## Working as an agent

Agents open pull requests all day; each merges itself when Checks pass and
ships straight to the owner. See [docs/RELEASING.md](./docs/RELEASING.md).

- **PR title is a conventional commit** (`feat(payments): …`, `fix(zelle): …`).
  It becomes the commit and decides the version. `!` only for a real break.
- **Say what changes for her** in the PR body, in one plain sentence, and
  `Fixes #N` for the issue — that is how her report shows "Fixed in vX.Y.Z".
- **Anything she sees differently updates the tour, Help and the test plan**
  in the same PR: a stop in `guided-tour.tsx` (new stops are offered to the
  release notes for "Show me"), a guide in `lib/help/content.ts`, a case in
  `lib/help/acceptance-cases.json`.
- **Every new server action starts with `signedIn()`/`requireSignedIn()`.**
  `action-guards.test.ts` fails otherwise; never add to its `PUBLIC` list
  without a reason that holds up.
- **Migrations are new, additive files** sorting after the newest on main.
  Production runs them before the new code is live; the old code must still work.
- **Tests first for bugs.** A failing test that shows the bug, then the fix.
- **Never touch production data** or run anything against the hosted project.
  The tests refuse to; don't work around that.
- **The owner is "Boss" in the UI**, and not technical: plain words in anything
  she reads.

---

## Deployment

### Web (Vercel)
- Deployed via Vercel with automatic git deploys
- `vercel.json` configures daily cron at `/api/cron/daily-reminders` (6 PM UTC)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APP_URL` (the address in parents' links), `ANTHROPIC_API_KEY` (reading roster screenshots; CSV import works without it), `RESEND_API_KEY` (parent emails; without it they are logged as skipped)

---

## Future Roadmap Ideas

1. Supabase realtime subscriptions to replace polling
2. Student attendance reports and analytics dashboard
3. Parent-facing portal for viewing invoices and making payments
4. Multi-user support with role-based access control
5. Official WhatsApp Business API, if sending from the Outbox by hand ever becomes a chore
6. Export data to CSV/Excel
7. Mobile app or PWA for field use during sessions
