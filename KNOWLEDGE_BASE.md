# CoachOS - Knowledge Base

> A comprehensive reference document for developers and AI agents working on this codebase.

**See Also:**
- [CLAUDE.md](./CLAUDE.md) - High-level overview for AI assistants
- [docs/DECISIONS.md](./docs/DECISIONS.md) - Architecture decision records (ADRs)
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) - Version history and changes

---

## Quick Reference

### Tech Stack
| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Monorepo | Turborepo | ^2.3.0 | Workspace orchestration |
| Package Manager | npm workspaces | 10.2.0 | Dependency management |
| Web Framework | Next.js (App Router) | 14.2.21 | SSR/SSG dashboard |
| UI Library | React | ^18.3.1 | Component rendering |
| Component Kit | shadcn/ui (CVA) | ^0.7.1 | Pre-styled UI primitives |
| Styling | Tailwind CSS | ^3.4.16 | Utility-first CSS |
| CSS Animations | tailwindcss-animate | ^1.0.7 | Transition utilities |
| Class Merging | clsx + tailwind-merge | ^2.1.1 / ^2.6.0 | Conditional class names |
| Database | Supabase (PostgreSQL) | ^2.47.10 | Data storage + auth |
| Auth SSR | @supabase/ssr | ^0.5.2 | Cookie-based server auth |
| Icons | lucide-react | ^0.468.0 | SVG icon components |
| Toasts | sonner | ^1.7.1 | Notification system |
| Dates | date-fns | ^4.1.0 | Date formatting |
| WhatsApp | whatsapp-web.js | ^1.26.0 | WhatsApp Web automation |
| QR Code | qrcode (Node.js) | ^1.5.4 | QR code generation |
| TypeScript | TypeScript | ^5.7.0 | Type safety |
| Deployment (web) | Vercel | - | Serverless hosting |
| Deployment (bot) | Railway (Docker) | - | Container hosting |

### Key Commands
```bash
# Development
npm run dev           # Start all apps (Turborepo)
npm run dev:web       # Start web app only (http://localhost:3000)
npm run dev:bot       # Start WhatsApp bot only

# Build
npm run build         # Build all workspaces
npm run lint          # Lint all workspaces

# Database
npm run db:migrate    # Push Supabase migrations

# Individual apps
cd apps/web && npx next build    # Build web
cd apps/web && npx next dev      # Dev web
cd apps/whatsapp-bot && npm run dev   # Dev bot (needs Chromium)
```

---

## Feature Inventory

| # | Feature | Status | Key Files |
|---|---------|--------|-----------|
| 1 | Authentication (email/password) | Complete | `lib/actions/auth.ts`, `lib/supabase/middleware.ts` |
| 2 | Dashboard with stats | Complete | `app/(dashboard)/dashboard/page.tsx` |
| 3 | School management (CRUD) | Complete | `actions/schools.ts`, `queries/schools.ts`, `schools-page-client.tsx` |
| 4 | Program management (per school) | Complete | `actions/programs.ts`, `queries/programs.ts` |
| 5 | Student management (CRUD + parents) | Complete | `actions/students.ts`, `queries/students.ts`, `students-page-client.tsx` |
| 6 | Parent management (CRUD + link to students) | Complete | `actions/students.ts` (createParent, linkParent) |
| 7 | Enrollment system | Complete | `actions/students.ts` (enrollStudent, withdrawEnrollment) |
| 8 | Session scheduling | Complete | `actions/schedule.ts`, `queries/schedule.ts` |
| 9 | Attendance tracking | Complete | `actions/schedule.ts`, `schedule-page-client.tsx` |
| 10 | Invoice generation | Complete | `actions/payments.ts`, `queries/payments.ts` |
| 11 | Payment recording | Complete | `actions/payments.ts`, `payments-page-client.tsx` |
| 12 | Message templates | Complete | `actions/messages.ts`, `queries/messages.ts` |
| 13 | Message queue + sending | Complete | `messaging-page-client.tsx`, bot `message-queue.ts` |
| 14 | WhatsApp bot (QR, send) | Complete | `whatsapp-bot/src/client.ts`, `health.ts` |
| 15 | Daily cron reminders | Complete | `api/cron/daily-reminders/route.ts` |
| 16 | Lead/sales pipeline | Complete | `actions/leads.ts`, `queries/leads.ts`, `marketing-page-client.tsx` |
| 17 | System configuration | Complete | `actions/config.ts`, `queries/config.ts`, `settings-page-client.tsx` |
| 18 | Bulk import (schools/students/parents) | Complete | `actions/bulk-import.ts`, `bulk-import-dialog.tsx`, `quick-entry-grid.tsx`, `paste-import.tsx` |
| 19 | WhatsApp setup wizard | Complete | `whatsapp-setup-wizard.tsx` (4-step guided setup) |

---

## Architecture Documentation

### Data Flow Pattern

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Server Page  │───>│  Server Query │───>│   Supabase   │
│  (page.tsx)   │    │ (queries/*.ts)│    │  PostgreSQL  │
└──────┬───────┘    └──────────────┘    └──────────────┘
       │ props                                  ^
       v                                        │
┌──────────────┐    ┌──────────────┐            │
│ Client Page   │───>│ Server Action │────────────┘
│ (*-client.tsx)│    │(actions/*.ts) │  revalidatePath()
└──────────────┘    └──────────────┘
       │
       v
┌──────────────┐
│  Form Dialog  │  (modal components for create/edit)
│(*-dialog.tsx) │
└──────────────┘
```

### Server Action Pattern

Every mutation follows this exact pattern:

```typescript
"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createResource(formData: FormData) {
  const supabase = createServerSupabase();

  // 1. Extract and validate
  const name = formData.get("name") as string;
  if (!name || name.trim().length === 0) {
    return { error: "Name is required." };
  }

  // 2. Execute mutation
  const { data, error } = await supabase
    .from("table")
    .insert({ name: name.trim() })
    .select()
    .single();

  // 3. Handle errors
  if (error) {
    console.error("Error creating resource:", error);
    return { error: "Failed to create. Please try again." };
  }

  // 4. Revalidate and return
  revalidatePath("/resources");
  return { data };
}
```

### Server Query Pattern

```typescript
import { createServerSupabase } from "@/lib/supabase/server";

export async function getResources() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("table")
    .select("*, relations(*)")
    .order("name");
  if (error) throw error;
  return data || [];
}
```

### Client Component Pattern

```typescript
"use client";

import { useState } from "react";
import { toast } from "sonner";

export function ResourcePageClient({ resources }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {/* Page content with list/grid */}
      <ResourceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
```

### WhatsApp Message Flow

```
Vercel Cron (6 PM daily)
        │
        v
daily-reminders/route.ts
        │  renderTemplate(template, variables)
        v
message_queue table (status: "pending")
        │
        v
WhatsApp Bot (polls queue)
  message-queue.ts
        │
        v
whatsapp-web.js → WhatsApp API
        │
        v
message_logs table (status: "sent")
```

---

## Database Schema

### 18 Tables

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `schools` | Partner school locations | Has many programs |
| `programs` | Sports programs at schools | Belongs to school, has enrollments |
| `students` | Youth athletes | Has parents via student_parents |
| `parents` | Student guardians | Has students, receives messages |
| `student_parents` | Many-to-many link | student_id + parent_id + relationship |
| `enrollments` | Student-program registration | student_id + program_id |
| `schedule_templates` | Recurring schedule rules | program_id + day_of_week + times |
| `sessions` | Actual class instances | program_id + date + times |
| `attendance` | Per-student session records | session_id + student_id + status |
| `invoices` | Monthly billing | parent_id + student_id + program_id |
| `payments` | Payment records | invoice_id + amount + method |
| `message_templates` | Reusable message formats | {{variable}} placeholders |
| `message_queue` | Outgoing message buffer | recipient + message + status |
| `message_logs` | Sent message history | Tracks delivery status |
| `leads` | Sales pipeline prospects | stage-based funnel |
| `lead_activities` | Lead interaction history | lead_id + type + description |
| `config` | System settings | key-value with UI metadata |
| `whatsapp_state` | Bot connection state | status + qr_code + phone_number |

### Key Types (from `types/database.ts`)

```typescript
type School = {
  id: string; name: string; address: string | null;
  contact_name: string | null; contact_email: string | null;
  contact_phone: string | null; whatsapp_group_id: string | null;
  status: "active" | "inactive" | "archived";
  notes: string | null; created_at: string; updated_at: string;
};

type Student = {
  id: string; first_name: string; last_name: string;
  grade: string | null; date_of_birth: string | null;
  medical_notes: string | null; notes: string | null;
  status: "active" | "inactive";
  created_at: string; updated_at: string;
};

type Parent = {
  id: string; first_name: string; last_name: string;
  email: string | null; phone: string;
  preferred_payment: "cash" | "zelle" | "venmo";
  venmo_handle: string | null; zelle_identifier: string | null;
  notes: string | null; created_at: string; updated_at: string;
};

type WhatsAppState = {
  id: string;
  status: "disconnected" | "connecting" | "qr_ready" | "connected";
  qr_code: string | null; phone_number: string | null;
  last_connected_at: string | null; updated_at: string;
};
```

---

## File Reference

### UI Components (`apps/web/src/components/ui/`)
```
ui/
├── badge.tsx        # Status indicators (success, warning, secondary, outline)
├── button.tsx       # 6 variants (default, destructive, outline, secondary, ghost, link) x 4 sizes
├── card.tsx         # Card, CardHeader, CardTitle, CardDescription, CardContent
├── dialog.tsx       # Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
├── input.tsx        # Text input with forwardRef
├── label.tsx        # Form labels
├── select.tsx       # Dropdown select with options array prop
├── switch.tsx       # Toggle switch
├── tabs.tsx         # Tabs, TabsList, TabsTrigger, TabsContent
└── textarea.tsx     # Multi-line text input
```

### Server Actions (`apps/web/src/lib/actions/`)
```
actions/
├── auth.ts          # signIn(formData), signOut()
├── schools.ts       # createSchool, updateSchool, archiveSchool
├── students.ts      # createStudent, updateStudent, createParent, updateParent, linkParentToStudent, unlinkParentFromStudent, enrollStudent, withdrawEnrollment
├── programs.ts      # createProgram, updateProgram
├── payments.ts      # recordPayment, generateInvoices
├── schedule.ts      # createSession, updateAttendance
├── messages.ts      # sendMessage, createTemplate, updateTemplate
├── leads.ts         # createLead, updateLead, addLeadActivity
├── config.ts        # updateConfig, updateMultipleConfigs
└── bulk-import.ts   # bulkCreateSchools, bulkCreateStudents, bulkCreateParents
```

---

## Extension Points

### How to Add a New Entity (e.g., "Equipment")
1. Add type to `apps/web/src/types/database.ts`
2. Create migration in `supabase/migrations/`
3. Create `apps/web/src/lib/queries/equipment.ts` with fetch functions
4. Create `apps/web/src/lib/actions/equipment.ts` with CRUD server actions
5. Create `apps/web/src/components/equipment-page-client.tsx`
6. Create `apps/web/src/components/equipment-form-dialog.tsx`
7. Create `apps/web/src/app/(dashboard)/equipment/page.tsx` (server component)
8. Add entry to `navigation[]` in `app/(dashboard)/layout.tsx`

### How to Add a New Message Template Variable
1. Define the variable in the message template body as `{{variable_name}}`
2. In `api/cron/daily-reminders/route.ts`, pass it via `renderTemplate(template, { variable_name: value })`
3. The shared `renderTemplate()` in `packages/shared/src/template-engine.ts` handles substitution

### How to Add a New Bulk Import Entity Type
1. Add type and server action in `apps/web/src/lib/actions/bulk-import.ts`
2. Add column config to `COLUMN_CONFIGS` in `apps/web/src/components/bulk-import-dialog.tsx`
3. Add case to `handleImport()` switch in the same file
4. Add entries to `TITLES`, `DESCRIPTIONS`, and `PASTE_PLACEHOLDERS` maps

### How to Add a New shadcn/ui Component
```bash
# shadcn components are manually installed — copy from ui.shadcn.com
# Place in apps/web/src/components/ui/
# Follow the existing CVA + forwardRef pattern
```

---

## Common Code Patterns

### Supabase Server Client Creation
```typescript
import { createServerSupabase } from "@/lib/supabase/server";
const supabase = createServerSupabase();
```

### Toast Notifications
```typescript
import { toast } from "sonner";
toast.success("Record created");
toast.error("Something went wrong");
```

### Tailwind Class Merging
```typescript
import { cn } from "@/lib/utils";
<div className={cn("base-classes", isActive && "active-classes")} />
```

### Currency Formatting
```typescript
import { formatCurrency } from "@/lib/utils";
formatCurrency(150);  // "$150.00"
```

### Phone Formatting
```typescript
import { formatPhone } from "@/lib/utils";
formatPhone("5551234567");  // "(555) 123-4567"
```

---

## Environment Variables

### Web App (`apps/web/.env.local`)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=your-cron-secret
WHATSAPP_BOT_URL=http://localhost:3001
```

### WhatsApp Bot (`apps/whatsapp-bot/.env`)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

---

## Development History

- Project initialized as a Turborepo monorepo with npm workspaces
- Core CRUD operations built for schools, students, parents, programs, enrollments
- Scheduling system with sessions, attendance tracking, and schedule templates
- Payment system with invoices and multi-method payment recording (cash, Zelle, Venmo)
- WhatsApp integration via whatsapp-web.js with QR code authentication flow
- Message templating system with shared `renderTemplate()` package
- Automated daily reminders via Vercel cron (practice + payment)
- Lead/marketing pipeline for new school acquisition
- Bulk import system for rapid data entry from WhatsApp contacts
- WhatsApp setup wizard replacing technical deployment instructions
- Terminology updated from "Coach" to "Boss" to match owner's role

---

*Last updated: 2026-02-11*
*Maintained by: Development Team & AI Agents*
