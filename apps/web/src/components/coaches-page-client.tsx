"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoachFormDialog } from "@/components/coach-form-dialog";
import { CoachSafeguardingDialog } from "@/components/coach-safeguarding-dialog";
import { CoachClearanceBadge } from "@/components/coach-clearance-badge";
import { deleteCoach } from "@/lib/actions/coaches";
import { useAction } from "@/lib/use-action";
import { formatCurrency } from "@/lib/utils";
import { UserCheck, Mail, Plus, Pencil, Trash2, CalendarClock, ShieldCheck } from "lucide-react";
import { PhoneLink } from "@/components/phone-link";
import type { Coach } from "@/types/database";
import type { CoachWithWorkload } from "@/lib/queries/coaches";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  prospective: "bg-blue-100 text-blue-700",
  inactive: "bg-gray-100 text-gray-600",
};

export function CoachesPageClient({ coaches }: { coaches: CoachWithWorkload[] }) {
  const { run, pending } = useAction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Coach | undefined>();
  const [safeguarding, setSafeguarding] = useState<CoachWithWorkload | undefined>();

  const totals = useMemo(() => {
    const active = coaches.filter((c) => c.status === "active");
    return {
      active: active.length,
      covering: active.filter((c) => c.sessions_upcoming > 0).length,
      // Only per-session coaches can be totalled; hourly ones return null.
      owed: coaches.reduce((sum, c) => sum + (c.owed ?? 0), 0),
      unpriced: coaches.filter((c) => c.status === "active" && c.owed === null).length,
      notCleared: active.filter((c) => c.clearance.status === "not_cleared").length,
    };
  }, [coaches]);

  function openNew() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(coach: Coach) {
    setEditing(coach);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <UserCheck className="mt-1.5 hidden h-6 w-6 shrink-0 text-muted-foreground sm:block" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Coaches</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Who runs the practices, and what they&apos;re owed.
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="h-11 w-full shrink-0 sm:h-10 sm:w-auto">
          <Plus className="h-4 w-4 mr-1" /> Add Coach
        </Button>
      </div>

      {totals.notCleared > 0 && (
        <div role="alert" data-testid="coaches-not-cleared" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>
            {totals.notCleared} active coach{totals.notCleared === 1 ? " isn't" : "es aren't"} cleared to work with children.
          </strong>{" "}
          A background check (with the sex-offender registry), abuse-prevention training, CPR / First Aid and a
          signed code of conduct must be on file before they run a practice. Open Safeguarding on each to fill it in.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.active}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Covering practices
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.covering}</p>
        </div>
        <div className="col-span-2 rounded-xl border bg-card p-4 sm:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Owed for practices run
          </p>
          <p className="mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums">
            {formatCurrency(totals.owed)}
          </p>
          {totals.unpriced > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {totals.unpriced} coach{totals.unpriced === 1 ? "" : "es"} without a
              per-practice rate isn&apos;t counted
            </p>
          )}
        </div>
      </div>

      {/* Roster */}
      {coaches.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
          <UserCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No coaches yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the people who run your practices, then assign them to a weekly slot on
            the schedule.
          </p>
          <Button className="mt-4 h-11 sm:h-9" size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Add the first coach
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {coaches.map((coach) => (
            <div
              key={coach.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-medium">
                    {coach.first_name} {coach.last_name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusStyles[coach.status] ?? statusStyles.inactive}`}
                  >
                    {coach.status}
                  </span>
                  <CoachClearanceBadge clearance={coach.clearance} />
                  {coach.weekly_slots > 0 && (
                    <Badge variant="secondary">
                      <CalendarClock className="mr-1 h-3 w-3" />
                      {coach.weekly_slots} weekly slot
                      {coach.weekly_slots === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <PhoneLink phone={coach.phone} />
                  {coach.email && (
                    <a
                      href={`mailto:${coach.email}`}
                      className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{coach.email}</span>
                    </a>
                  )}
                  {coach.source && <span>via {coach.source}</span>}
                </p>

                <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                  {coach.sessions_completed} run · {coach.sessions_upcoming} upcoming
                  {coach.owed !== null && (
                    <> · owed <span className="whitespace-nowrap">{formatCurrency(coach.owed)}</span></>
                  )}
                  {coach.owed === null && coach.pay_rate !== null && (
                    <> · {formatCurrency(Number(coach.pay_rate))}/hour, hours not tracked</>
                  )}
                  {coach.pay_rate === null && <> · no rate set</>}
                </p>

                {coach.notes && (
                  <p className="mt-1 break-words text-sm text-muted-foreground">{coach.notes}</p>
                )}

                {coach.status === "active" && coach.clearance.status === "not_cleared" && (coach.weekly_slots > 0 || coach.sessions_upcoming > 0) && (
                  <p className="mt-1 text-sm font-medium text-red-700">
                    Scheduled to coach but not cleared — missing or expired: {coach.clearance.problems.join(", ")}.
                  </p>
                )}
              </div>

              {/* Real, labelled buttons on phones; compact icons from sm up. */}
              <div className="grid grid-cols-3 gap-2 border-t pt-3 sm:flex sm:items-center sm:gap-1 sm:border-t-0 sm:pt-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 border sm:h-9 sm:border-0"
                  aria-label={`Safeguarding for ${coach.first_name} ${coach.last_name}`}
                  onClick={() => setSafeguarding(coach)}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="ml-2 sm:hidden">Checks</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 border sm:h-9 sm:border-0"
                  aria-label={`Edit ${coach.first_name} ${coach.last_name}`}
                  onClick={() => openEdit(coach)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="ml-2 sm:hidden">Edit</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 border text-destructive hover:text-destructive sm:h-9 sm:border-0"
                  aria-label={`Remove ${coach.first_name} ${coach.last_name}`}
                  disabled={pending}
                  onClick={() =>
                    run(() => deleteCoach(coach.id), {
                      success: `${coach.first_name} removed`,
                      error: `${coach.first_name} wasn't removed`,
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="ml-2 sm:hidden">Remove</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CoachFormDialog open={dialogOpen} onOpenChange={setDialogOpen} coach={editing} />
      <CoachSafeguardingDialog
        open={!!safeguarding}
        onOpenChange={(o) => !o && setSafeguarding(undefined)}
        coach={safeguarding}
        clearance={safeguarding?.clearance}
      />
    </div>
  );
}
