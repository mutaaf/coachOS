"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  ClipboardList,
  Check,
  X,
  ArrowUp,
  UserPlus,
  Phone,
  Mail,
  Copy,
} from "lucide-react";
import {
  convertRegistration,
  promoteFromWaitlist,
  setRegistrationStatus,
  setRegistrationPaymentStatus,
} from "@/lib/actions/registrations";
import type { ProgramAvailability, RegistrationStatus } from "@/types/database";
import type { RegistrationWithProgram } from "@/lib/queries/registrations";

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

  const visible = useMemo(
    () =>
      registrations.filter(
        (r) =>
          (filter === "all" || r.status === filter) &&
          (programFilter === "all" || r.program_id === programFilter)
      ),
    [registrations, filter, programFilter]
  );

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: registrations.length };
    for (const r of registrations) base[r.status] = (base[r.status] ?? 0) + 1;
    return base;
  }, [registrations]);

  /** Runs a server action, surfaces its error, and refreshes on success. */
  function run(action: () => Promise<{ error?: string; success?: boolean }>, okMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(okMessage);
      router.refresh();
    });
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/join/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Registration link copied");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registrations</h1>
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
            No active programs yet. Create one under Schools, set its capacity, and turn on
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

                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {p.seats_taken}/{p.capacity} filled
                    </span>
                    <span>
                      {full
                        ? `${p.waitlist_count} waiting`
                        : `${p.seats_remaining} left`}
                    </span>
                  </div>

                  {p.public_slug && (
                    <button
                      type="button"
                      onClick={() => copyLink(p.public_slug!)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <Copy className="h-3 w-3" />
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
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "rounded-full bg-primary px-3 py-1 text-xs font-medium capitalize text-primary-foreground"
                : "rounded-full border px-3 py-1 text-xs font-medium capitalize hover:bg-accent"
            }
          >
            {f} {counts[f] ? `(${counts[f]})` : ""}
          </button>
        ))}
        <div className="ml-auto min-w-[200px]">
          <Select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            options={[
              { value: "all", label: "All programs" },
              ...availability.map((p) => ({ value: p.program_id, label: p.name })),
            ]}
          />
        </div>
      </div>

      {/* Registrations */}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {r.child_first_name} {r.child_last_name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[r.status]}`}
                  >
                    {r.status}
                    {r.status === "waitlisted" && r.waitlist_position
                      ? ` #${r.waitlist_position}`
                      : ""}
                  </span>
                  {r.enrollment_id && <Badge variant="secondary">Enrolled</Badge>}
                  {r.payment_status === "paid" && <Badge variant="success">Paid</Badge>}
                </div>

                <p className="mt-1 text-sm text-muted-foreground">
                  {r.program?.name}
                  {r.program?.school?.name ? ` · ${r.program.school.name}` : ""}
                  {r.child_grade ? ` · ${r.child_grade} grade` : ""}
                </p>

                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {r.parent_first_name} {r.parent_last_name}
                  </span>
                  <a
                    href={`https://wa.me/${r.parent_phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {r.parent_phone}
                  </a>
                  {r.parent_email && (
                    <a
                      href={`mailto:${r.parent_email}`}
                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {r.parent_email}
                    </a>
                  )}
                </p>

                {r.medical_notes && (
                  <p className="mt-1 text-sm text-amber-700">Note: {r.medical_notes}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {r.status === "waitlisted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => promoteFromWaitlist(r.id), "Moved off the waitlist")
                    }
                  >
                    <ArrowUp className="mr-1 h-3.5 w-3.5" />
                    Give a seat
                  </Button>
                )}

                {r.status === "pending" && (
                  <Button
                    size="sm"
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
                    disabled={pending}
                    onClick={() =>
                      run(() => convertRegistration(r.id), "Added to the roster")
                    }
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    Add to roster
                  </Button>
                )}

                {r.payment_status === "unpaid" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => setRegistrationPaymentStatus(r.id, "paid"),
                        "Marked paid"
                      )
                    }
                  >
                    Mark paid
                  </Button>
                )}

                {r.status !== "cancelled" && r.status !== "declined" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(() => setRegistrationStatus(r.id, "cancelled"), "Cancelled")
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
