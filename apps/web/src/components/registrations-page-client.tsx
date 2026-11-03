"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { attributionSummary } from "@/lib/attribution";
import { Select } from "@/components/ui/select";
import {
  ClipboardList,
  Check,
  X,
  ArrowUp,
  UserPlus,
  Mail,
  Copy,
  RotateCcw,
} from "lucide-react";
import {
  cancelRegistration,
  convertRegistration,
  promoteFromWaitlist,
  promoteNextInLine,
  restoreRegistration,
  setRegistrationStatus,
} from "@/lib/actions/registrations";
import type { ProgramAvailability, RegistrationStatus } from "@/types/database";
import type { RegistrationWithProgram } from "@/lib/queries/registrations";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SamePersonPrompt, childMatches, type SameMatch } from "@/components/same-person-prompt";
import { PhoneLink } from "@/components/phone-link";

const STATUS_STYLES: Record<RegistrationStatus, string> = {
  pending: "bg-gray-100 text-gray-700",
  confirmed: "bg-green-100 text-green-800",
  waitlisted: "bg-amber-100 text-amber-800",
  cancelled: "bg-gray-100 text-gray-500",
  declined: "bg-red-100 text-red-700",
};

const FILTERS = ["all", "pending", "confirmed", "waitlisted", "cancelled", "declined"] as const;

interface RegistrationsPageClientProps {
  registrations: RegistrationWithProgram[];
  availability: ProgramAvailability[];
}

export function RegistrationsPageClient({
  registrations,
  availability,
}: RegistrationsPageClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [programFilter, setProgramFilter] = useState("all");

  const visible = useMemo(() => {
    const rows = registrations.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (programFilter === "all" || r.program_id === programFilter)
    );
    // The waitlist reads in line order, #1 first. Newest-first put the last
    // family to join at the top, and "Give a seat" went to them.
    const slots = rows.flatMap((r, i) => (r.status === "waitlisted" ? [i] : []));
    const inLine = slots
      .map((i) => rows[i])
      .sort(
        (a, b) =>
          (a.program?.name ?? "").localeCompare(b.program?.name ?? "") ||
          a.program_id.localeCompare(b.program_id) ||
          (a.waitlist_position ?? Infinity) - (b.waitlist_position ?? Infinity) ||
          a.created_at.localeCompare(b.created_at)
      );
    slots.forEach((slot, n) => (rows[slot] = inLine[n]));
    return rows;
  }, [registrations, filter, programFilter]);

  // Per program, the family whose turn it is.
  const firstInLine = useMemo(() => {
    const first = new Map<string, RegistrationWithProgram>();
    for (const r of registrations) {
      if (r.status !== "waitlisted") continue;
      const current = first.get(r.program_id);
      if (
        !current ||
        (r.waitlist_position ?? Infinity) < (current.waitlist_position ?? Infinity) ||
        (r.waitlist_position === current.waitlist_position && r.created_at < current.created_at)
      ) {
        first.set(r.program_id, r);
      }
    }
    return first;
  }, [registrations]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: registrations.length };
    for (const r of registrations) base[r.status] = (base[r.status] ?? 0) + 1;
    return base;
  }, [registrations]);

  /**
   * Runs a server action, surfaces its error, and refreshes on success. One at
   * a time: `pending` only disables the buttons once a render lands, so a quick
   * double tap on "Add to roster" got in twice.
   */
  const busy = useRef(false);
  function run(action: () => Promise<{ error?: string; success?: boolean }>, okMessage: string) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await action();
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        if (!result?.success) return;
        toast.success(okMessage);
        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }

  // A child of the same name already on file: "Is this the same Mia?"
  const [asking, setAsking] = useState<{ registrationId: string; name: string; matches: SameMatch[] } | null>(null);

  function addToRoster(r: RegistrationWithProgram, choice?: { studentId?: string; createNew?: boolean }) {
    run(async () => {
      const result = await convertRegistration(r.id, choice);
      if ("matches" in result) {
        setAsking({ registrationId: r.id, name: r.child_first_name, matches: childMatches(result.matches) });
        return {};
      }
      setAsking(null);
      return result;
    }, "Added to the roster");
  }

  // Someone else is ahead in line: say who, and only skip them if she says so.
  function giveSeat(r: RegistrationWithProgram) {
    run(async () => {
      const result = await promoteFromWaitlist(r.id);
      if (!("ahead" in result) || !result.ahead) return result;
      const { name, position } = result.ahead;
      const skip = window.confirm(
        `${name} is #${position} in line, ahead of ${r.child_first_name}. Give the seat to ${r.child_first_name} anyway?`
      );
      return skip ? promoteFromWaitlist(r.id, { outOfTurn: true }) : {};
    }, `${r.child_first_name} has a seat`);
  }

  function giveSeatToNext(p: ProgramAvailability) {
    const next = firstInLine.get(p.program_id);
    run(() => promoteNextInLine(p.program_id), `${next?.child_first_name ?? "The next family"} has a seat`);
  }

  // Cancelling asks first, and — for a child already on the roster — whether
  // to take them off it, so a cancelled child isn't still billed.
  const [cancelling, setCancelling] = useState<RegistrationWithProgram | null>(null);
  const [withdraw, setWithdraw] = useState(true);

  function confirmCancel() {
    const r = cancelling;
    if (!r) return;
    const offRoster = withdraw && r.enrollment?.status === "active";
    setCancelling(null);
    run(
      () => cancelRegistration(r.id, { withdraw: offRoster }),
      offRoster ? `Cancelled, and ${r.child_first_name} is off the roster` : "Cancelled"
    );
  }

  function restore(r: RegistrationWithProgram) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await restoreRegistration(r.id);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success(
          result.status === "confirmed"
            ? `Restored — ${r.child_first_name} has a seat`
            : `Restored — the session is full, so ${r.child_first_name} is back on the waitlist`
        );
        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/join/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Registration link copied");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-1 hidden h-6 w-6 shrink-0 text-muted-foreground sm:block" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Registrations</h1>
          <p className="text-sm text-muted-foreground">
            Everything parents submitted, and who&apos;s waiting for a seat.
          </p>
        </div>
      </div>

      {/* Capacity per program — the 12-seat rule, made visible. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Seats
        </h2>
        {availability.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active sessions yet. Put a program on at a school under Programs, set its capacity, and turn on
            registration to get a shareable link.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availability.map((p) => {
              const pct = Math.min(100, Math.round((p.seats_taken / p.capacity) * 100));
              const full = p.seats_remaining < 1;
              return (
                <div key={p.program_id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.school_name}</p>
                    </div>
                    {p.registration_open ? (
                      <Badge variant="success">Open</Badge>
                    ) : (
                      <Badge variant="outline">Closed</Badge>
                    )}
                  </div>

                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={full ? "h-full bg-amber-500" : "h-full bg-green-500"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                    <span>
                      {p.seats_taken}/{p.capacity} filled
                    </span>
                    <span className={full && p.waitlist_count > 0 ? "font-medium text-amber-700" : undefined}>
                      {full
                        ? `${p.waitlist_count} waiting`
                        : `${p.seats_remaining} left`}
                    </span>
                  </div>

                  {p.waitlist_count > 0 && p.seats_remaining > 0 && (
                    <Button
                      className="mt-3 h-11 w-full sm:h-9"
                      disabled={pending}
                      onClick={() => giveSeatToNext(p)}
                    >
                      <ArrowUp className="mr-1 h-3.5 w-3.5" />
                      Give a seat to next in line
                    </Button>
                  )}

                  {p.public_slug && (
                    <button
                      type="button"
                      onClick={() => copyLink(p.public_slug!)}
                      className="mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium hover:bg-accent sm:h-9 sm:text-xs"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy registration link
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? "h-11 shrink-0 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-medium capitalize tabular-nums text-primary-foreground sm:h-8 sm:px-3 sm:text-xs"
                  : "h-11 shrink-0 whitespace-nowrap rounded-full border bg-card px-4 text-sm font-medium capitalize tabular-nums hover:bg-accent sm:h-8 sm:px-3 sm:text-xs"
              }
            >
              {f} {counts[f] ? `(${counts[f]})` : ""}
            </button>
          ))}
        </div>
        <div className="w-full sm:ml-auto sm:w-auto sm:min-w-[200px]">
          <Select
            aria-label="Session"
            className="h-11 text-base sm:h-10 sm:text-sm"
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            options={[
              { value: "all", label: "All sessions" },
              ...availability.map((p) => ({ value: p.program_id, label: p.name })),
            ]}
          />
        </div>
      </div>

      {/* Registrations */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filter === "all" && programFilter === "all" ? (
            <p>
              Nothing here yet. Copy a session&apos;s registration link above and send it to parents — what they
              submit shows up here.
            </p>
          ) : (
            <>
              <p>Nothing here yet.</p>
              <Button
                variant="outline"
                className="mt-3 h-11 sm:h-9"
                onClick={() => {
                  setFilter("all");
                  setProgramFilter("all");
                }}
              >
                Show all registrations
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium">
                    {r.child_first_name} {r.child_last_name}
                  </span>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[r.status]}`}
                  >
                    {r.status}
                    {r.status === "waitlisted" && r.waitlist_position
                      ? ` #${r.waitlist_position}`
                      : ""}
                  </span>
                  {r.enrollment?.status === "active" && <Badge variant="secondary">Enrolled</Badge>}
                  {/* From the invoice and the money recorded on it — never set by hand. */}
                  {r.invoice?.status === "paid" && <Badge variant="success">Paid</Badge>}
                  {r.invoice?.status === "overdue" && <Badge variant="warning">Overdue</Badge>}
                </div>

                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {r.program?.name}
                  {r.program?.school?.name ? ` · ${r.program.school.name}` : ""}
                  {r.child_grade ? ` · ${r.child_grade} grade` : ""}
                </p>

                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 text-sm text-muted-foreground">
                  <span>
                    {r.parent_first_name} {r.parent_last_name}
                  </span>
                  <PhoneLink phone={r.parent_phone} />
                  {r.parent_email && (
                    <a
                      href={`mailto:${r.parent_email}`}
                      className="inline-flex min-h-11 min-w-0 max-w-full sm:min-h-0 items-center gap-1 hover:text-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{r.parent_email}</span>
                    </a>
                  )}
                </p>

                {(attributionSummary(r.attribution) || r.how_heard) && (
                  <p className="mt-1 break-words text-xs text-muted-foreground" data-testid="registration-source">
                    Came from {[attributionSummary(r.attribution), r.how_heard ? `“${r.how_heard}”` : null].filter(Boolean).join(" · ")}
                  </p>
                )}

                {r.medical_notes && (
                  <p className="mt-1 text-sm text-amber-700">Note: {r.medical_notes}</p>
                )}
              </div>

              <div className="flex items-center gap-2 sm:flex-wrap">
                {r.status === "waitlisted" && (
                  <Button
                    size="sm"
                    className="h-11 flex-1 sm:h-9 sm:flex-none"
                    variant="outline"
                    disabled={pending}
                    onClick={() => giveSeat(r)}
                  >
                    <ArrowUp className="mr-1 h-3.5 w-3.5" />
                    Give a seat
                  </Button>
                )}

                {r.status === "pending" && (
                  <Button
                    size="sm"
                    className="h-11 flex-1 sm:h-9 sm:flex-none"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => setRegistrationStatus(r.id, "confirmed"), "Confirmed")
                    }
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Confirm
                  </Button>
                )}

                {r.status === "confirmed" && !r.enrollment_id && (
                  <Button
                    size="sm"
                    className="h-11 flex-1 sm:h-9 sm:flex-none"
                    disabled={pending}
                    onClick={() => addToRoster(r)}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    Add to roster
                  </Button>
                )}

                {r.status === "cancelled" && (
                  <Button size="sm" variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending} onClick={() => restore(r)}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    Restore
                  </Button>
                )}

                {r.status !== "cancelled" && r.status !== "declined" && (
                  <Button
                    size="sm"
                    className="ml-auto h-11 w-11 shrink-0 border p-0 sm:ml-0 sm:h-9 sm:w-9 sm:border-0"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Cancel ${r.child_first_name}'s registration`}
                    title="Cancel registration"
                    onClick={() => {
                      setWithdraw(true);
                      setCancelling(r);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent onClose={() => setCancelling(null)}>
          <DialogHeader>
            <DialogTitle>
              Cancel {cancelling?.child_first_name}&apos;s registration?
            </DialogTitle>
            <DialogDescription>
              {cancelling?.status === "waitlisted"
                ? "They come off the waitlist, and everyone behind them moves up."
                : "Their seat opens up for someone else. You can restore it later if there's still room."}
            </DialogDescription>
          </DialogHeader>
          {cancelling?.enrollment?.status === "active" && (
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={withdraw}
                onChange={(e) => setWithdraw(e.target.checked)}
              />
              <span>
                Also take {cancelling.child_first_name} off the {cancelling.program?.name ?? "session"} roster. They
                won&apos;t be billed again, and a bill that isn&apos;t due yet with nothing paid on it is removed.
              </span>
            </label>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button variant="destructive" className="h-11 sm:h-10" disabled={pending} onClick={confirmCancel}>
              Cancel registration
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent onClose={() => setAsking(null)}>
          <DialogHeader>
            <DialogTitle>Add to roster</DialogTitle>
          </DialogHeader>
          {asking && (
            <div className="mt-4">
              <SamePersonPrompt
                question={`Is this the same ${asking.name}?`}
                matches={asking.matches}
                sameLabel="Yes, same child"
                newLabel="No, add a new child"
                onSame={(studentId) => {
                  const r = registrations.find((x) => x.id === asking.registrationId);
                  if (r) addToRoster(r, { studentId });
                }}
                onNew={() => {
                  const r = registrations.find((x) => x.id === asking.registrationId);
                  if (r) addToRoster(r, { createNew: true });
                }}
                disabled={pending}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
