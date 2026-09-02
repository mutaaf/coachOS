"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoachFormDialog } from "@/components/coach-form-dialog";
import { deleteCoach } from "@/lib/actions/coaches";
import { useAction } from "@/lib/use-action";
import { formatCurrency } from "@/lib/utils";
import { UserCheck, Phone, Mail, Plus, Pencil, Trash2, CalendarClock } from "lucide-react";
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

  const totals = useMemo(() => {
    const active = coaches.filter((c) => c.status === "active");
    return {
      active: active.length,
      covering: active.filter((c) => c.sessions_upcoming > 0).length,
      // Only per-session coaches can be totalled; hourly ones return null.
      owed: coaches.reduce((sum, c) => sum + (c.owed ?? 0), 0),
      unpriced: coaches.filter((c) => c.status === "active" && c.owed === null).length,
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <UserCheck className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Coaches</h1>
            <p className="text-sm text-muted-foreground">
              Who runs the sessions, and what they&apos;re owed.
            </p>
          </div>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Add Coach
        </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.active}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Covering sessions
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.covering}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Owed for sessions run
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCurrency(totals.owed)}
          </p>
          {totals.unpriced > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {totals.unpriced} coach{totals.unpriced === 1 ? "" : "es"} without a
              per-session rate isn&apos;t counted
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
            Add the people who run your sessions, then assign them to a weekly slot on
            the schedule.
          </p>
          <Button className="mt-4" size="sm" onClick={openNew}>
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
                  <span className="font-medium">
                    {coach.first_name} {coach.last_name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusStyles[coach.status] ?? statusStyles.inactive}`}
                  >
                    {coach.status}
                  </span>
                  {coach.weekly_slots > 0 && (
                    <Badge variant="secondary">
                      <CalendarClock className="mr-1 h-3 w-3" />
                      {coach.weekly_slots} weekly slot
                      {coach.weekly_slots === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <a
                    href={`https://wa.me/${coach.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {coach.phone}
                  </a>
                  {coach.email && (
                    <a
                      href={`mailto:${coach.email}`}
                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {coach.email}
                    </a>
                  )}
                  {coach.source && <span>via {coach.source}</span>}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {coach.sessions_completed} run · {coach.sessions_upcoming} upcoming
                  {coach.owed !== null && (
                    <> · owed {formatCurrency(coach.owed)}</>
                  )}
                  {coach.owed === null && coach.pay_rate !== null && (
                    <> · {formatCurrency(Number(coach.pay_rate))}/hour, hours not tracked</>
                  )}
                  {coach.pay_rate === null && <> · no rate set</>}
                </p>

                {coach.notes && (
                  <p className="mt-1 text-sm text-muted-foreground">{coach.notes}</p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(coach)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(() => deleteCoach(coach.id), {
                      success: `${coach.first_name} removed`,
                      error: `${coach.first_name} wasn't removed`,
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CoachFormDialog open={dialogOpen} onOpenChange={setDialogOpen} coach={editing} />
    </div>
  );
}
