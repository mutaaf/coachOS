# Testing

Everything here runs against a **local, throwaway Supabase stack in Docker**.
No test ever touches the hosted project — the business's real rosters, parents,
and payments live there, and a test run must never be able to reach them.

That guarantee is enforced in code, not by convention: `tests/helpers/db.ts` and
both Playwright configs read connection details from `supabase status` and
**refuse to start** if the API URL is not on localhost.

## Setup

```bash
brew install colima docker   # once, if you do not have them
npm run up                   # everything else
```

`npm run up` checks Node, repairs a stale Docker credential helper, starts
Colima, installs dependencies, starts Supabase, and installs the Playwright
browser — skipping whatever is already done. It is safe to run any time; on a
warm machine it takes a second and just confirms the environment is healthy.
Each check it performs corresponds to a trap listed under **Environment
nuances** in `CLAUDE.md`.

## Running the suites

```bash
npm test             # integration tests (Vitest, against local Postgres)
npm run test:e2e     # end-to-end, including the run-book
npm run down         # stop the stack and free the VM's memory
```

The marketing site has its own suites and shares this same stack:

```bash
cd ../rising-star-web-spark
npm run test         # component tests (Vitest + Testing Library, no database)
npm run test:e2e     # end-to-end against the local stack
```

## What is covered, and why

The suite is deliberately scoped to the paths the business runs on every week.
Each of these, if it broke, would mean someone getting a phone call.

### Seat capacity — `tests/integration/seats.test.ts`

The twelve-child cap is the core constraint of the business. Covered: seats fill
to capacity, the next parent is waitlisted with a position, positions are
sequential, a closed program refuses registrations, and the fee is carried onto
the registration.

The important one is concurrency. Twenty parents submitting at the same instant
against four seats must produce exactly four confirmations. Without the row lock
in `ops.submit_registration`, every one of them reads the same seat count and
every one is confirmed — which is how a twelve-child session ends up with
fifteen children in a gym.

### Registration to roster — `tests/integration/conversion.test.ts`

Turning a submission into real records. Covered: a parent, student, and
enrollment are created; an existing parent is matched by phone rather than
duplicated; siblings link to the one parent record; and the original submission
survives conversion.

The invariant worth naming: a seat is held by an active enrollment **or** by a
confirmed registration that has not become one yet, never both. Convert a
registration and `seats_taken` must not move.

### Permissions — `tests/integration/security.test.ts`

The most important file here. The anon key ships inside the marketing site's
JavaScript bundle, so it is public in practice. These tests assert that a
stranger holding it cannot read children's names, medical notes, or parents'
phone numbers from any operational table, and cannot write to them.

They also cover the narrow doors that are deliberately open: aggregate seat
counts (which carry no personal data — asserted by inspecting the columns), and
`public.submit_registration`, which creates a registration and returns only the
outcome.

One of these is a regression test for a real hole. `programs`, `partnerships`,
and `testimonials` shipped with a policy *named* for authenticated users that
was actually `FOR ALL TO public USING (true) WITH CHECK (true)` — anyone with
the anon key could delete every program listing on the live site. The tests
assert public reads still work and every public write is refused.

### The parent's path — `tests/e2e/registration.spec.ts`

Opening the link from a WhatsApp group and finding out whether your child has a
seat: confirmation, the waitlist with a position, a closed program, an unknown
link, and a double submit being caught.

### The dashboard — `tests/e2e/dashboard.spec.ts`

Every dashboard route redirects to login when signed out, and `/join/[slug]`
stays public — parents have no account and never should need one.

### The week's work — `tests/integration/operations.test.ts`

Sessions, attendance, and money, run against the app's real server actions
rather than a reimplementation, which is the only way a test catches a bug in
them. It found three: families with both parents on file were invoiced twice,
session generation silently lost a week whenever the session day fell earlier in
the week than today, and invoices were marked overdue on their own due date.

### Dates — `tests/integration/dates.test.ts`

`toISOString()` converts to UTC first, so from 7pm in Dallas it reports tomorrow.
These pin the boundary directly, because the bug only reproduces at certain times
of day — the run-book test found it by passing at 18:56 and failing at 19:01.

### The run-book — `tests/e2e/runbook.spec.ts`

The whole documented weekly workflow, executed in order through the real
interface: add the school, open registration, a signed-out parent registers, add
them to the roster, generate the term's sessions, mark attendance, invoice the
month, record a Zelle payment, fill the program, watch the next child waitlist,
free a seat, promote them, and check the books still balance.

Deliberately one long test. Each step runs on the state the previous one left,
which is the property that breaks in production and that isolated tests cannot
see. If you only run one thing, run this.

## Continuously

`.github/workflows/tests.yml` runs everything on push, on pull requests, and
daily at 12:00 UTC, against a Supabase stack built from the migrations on a clean
runner — so a migration that cannot build from scratch fails there rather than on
someone's laptop. Failure traces are uploaded as artifacts.

## Adding tests

`tests/helpers/db.ts` provides `seedProgram()`, `register()`, `availability()`,
and `truncateAll()`. Each `seedProgram()` call creates its own school and
program so tests never contend over the same seats, which matters because
several of them deliberately race.

Integration tests run with `fileParallelism: false` and Playwright with
`workers: 1`, for the same reason: they share one database, and a suite that
clears tables underneath a test in flight fails in ways that are miserable to
debug.
