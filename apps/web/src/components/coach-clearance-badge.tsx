import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CoachClearance } from "@/lib/coach-clearance";

/**
 * A coach's safeguarding status at a glance. Works in server and client
 * components; pass the result of getCoachClearance() / evaluateClearance().
 *
 *   <CoachClearanceBadge clearance={c} />            — the badge
 *   <CoachClearanceBadge clearance={c} warning />    — a full-width warning
 *     when they aren't cleared (renders nothing when they are), for the
 *     screens where a coach is put in charge of a program or practice.
 */
export function CoachClearanceBadge({
  clearance,
  warning = false,
  className,
}: {
  clearance: Pick<CoachClearance, "status" | "problems"> | null | undefined;
  warning?: boolean;
  className?: string;
}) {
  if (!clearance) return null;

  if (warning) {
    if (clearance.status !== "not_cleared") return null;
    return (
      <div
        role="alert"
        data-testid="coach-not-cleared"
        className={`flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 ${className ?? ""}`}
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>This coach isn&apos;t cleared to work with children.</strong> Missing or expired:{" "}
          {clearance.problems.join(", ")}. Update their safeguarding on the Coaches page before they run a practice.
        </span>
      </div>
    );
  }

  if (clearance.status === "cleared") {
    return (
      <Badge variant="success" className={className} data-testid="coach-clearance" title="Background check, training, CPR and code of conduct are all current">
        <ShieldCheck className="mr-1 h-3 w-3" /> Cleared
      </Badge>
    );
  }
  if (clearance.status === "expiring") {
    return (
      <Badge variant="warning" className={className} data-testid="coach-clearance" title="Something runs out within 30 days">
        <ShieldQuestion className="mr-1 h-3 w-3" /> Renewal due
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className={className} data-testid="coach-clearance" title={`Missing or expired: ${clearance.problems.join(", ")}`}>
      <ShieldAlert className="mr-1 h-3 w-3" /> Not cleared
    </Badge>
  );
}
