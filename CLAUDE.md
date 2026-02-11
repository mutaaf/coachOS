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
| Web Framework | Next.js (App Router) | 14.2.21 |
| UI | React + shadcn/ui + Tailwind CSS | React ^18.3, TW ^3.4.16 |
| Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.47.10 |
| Auth | Supabase Auth (email/password) | @supabase/ssr ^0.5.2 |
| WhatsApp Bot | whatsapp-web.js + Puppeteer | ^1.26.0 |
| Icons | lucide-react | ^0.468.0 |
| Toasts | sonner | ^1.7.1 |
| Dates | date-fns | ^4.1.0 |
| Deployment (web) | Vercel | vercel.json |
| Deployment (bot) | Railway (Docker) | railway.json |

### Key Design Decisions
1. **Supabase direct queries, no ORM** — simple `.from().select()` pattern, types defined manually in `types/database.ts`
2. **Server Actions for mutations** — all writes go through `"use server"` functions accepting FormData, returning `{ data } | { error }`
3. **Server queries for reads** — separate `lib/queries/` modules that throw on error, called from server components
4. **Client components for interactivity** — `*-page-client.tsx` pattern: server page fetches data, passes to client component
5. **Shared template engine** — `packages/shared` exports `renderTemplate()` for mustache-style message templating, used by both web cron and bot
6. **WhatsApp over email** — primary communication channel is WhatsApp via whatsapp-web.js headless browser

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
│   │   │   │   ├── *-page-client.tsx # Interactive page components (12)
│   │   │   │   ├── *-form-dialog.tsx # Modal forms (8)
│   │   │   │   ├── bulk-import-*.tsx # Bulk import system
│   │   │   │   └── whatsapp-setup-wizard.tsx
│   │   │   ├── lib/
│   │   │   │   ├── actions/          # Server actions (10 modules)
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
Pattern: `"use server"` → accept FormData → validate → Supabase insert/update → revalidatePath → return `{ data }` or `{ error }`. Key modules: `schools.ts`, `students.ts`, `payments.ts`, `messages.ts`, `bulk-import.ts`.

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
npm run dev:web      # Start Next.js dev server (http://localhost:3000)
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
npm run db:migrate   # Pushes migrations via Supabase CLI
```

---

## Known Considerations

1. **No ORM** — all queries are raw Supabase client calls. Types are manually maintained in `types/database.ts`. When adding columns, update both the migration AND the type file.
2. **FormData convention** — server actions accept `FormData`, not JSON objects. Client components create forms or manually construct FormData.
3. **Bulk import uses JSON** — unlike single-record actions that use FormData, bulk import actions accept typed arrays directly.
4. **WhatsApp bot requires Chromium** — the bot uses Puppeteer with a real Chromium instance. Local dev needs Chrome/Chromium installed. Docker image bundles chromium-slim.
5. **Polling, not realtime** — the WhatsApp setup wizard polls `whatsapp_state` every 3 seconds. The app does not use Supabase realtime subscriptions.
6. **No test framework** — there are currently no unit or integration tests configured.
7. **Owner terminology** — the UI calls the user "Boss" (not "Coach"). Keep this consistent.
8. **US phone formatting** — phone numbers default to US (+1) when only 10 digits are provided.

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

1. Add unit and integration tests (vitest or jest)
2. Supabase realtime subscriptions to replace polling
3. Student attendance reports and analytics dashboard
4. Parent-facing portal for viewing invoices and making payments
5. Multi-user support with role-based access control
6. WhatsApp bot incoming message handling (two-way chat)
7. Export data to CSV/Excel
8. Mobile app or PWA for field use during sessions
