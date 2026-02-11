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
