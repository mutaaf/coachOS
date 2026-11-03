"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CoachClearanceBadge } from "@/components/coach-clearance-badge";
import { updateCoachSafeguarding } from "@/lib/actions/coaches";
import { useAction } from "@/lib/use-action";
import { formatDateOnly } from "@/lib/dates";
import type { CoachClearance } from "@/lib/coach-clearance";
import type { Coach } from "@/types/database";

const itemStyle: Record<string, string> = {
  ok: "text-green-700",
  expiring: "text-orange-700",
  expired: "text-red-700",
  missing: "text-red-700",
};

/**
 * A coach's safeguarding record: the four things that have to be on file
 * before they are alone with children.
 */
export function CoachSafeguardingDialog({
  open,
  onOpenChange,
  coach,
  clearance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coach: Coach | undefined;
  clearance: CoachClearance | undefined;
}) {
  const { run, pending } = useAction();
  if (!coach) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const ok = await run(() => updateCoachSafeguarding(coach!.id, formData), {
      success: "Safeguarding saved",
      error: "Safeguarding wasn't saved",
    });
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-lg">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>
            Safeguarding — {coach.first_name} {coach.last_name}
          </DialogTitle>
        </DialogHeader>

        {clearance && (
          <div className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <CoachClearanceBadge clearance={clearance} />
            <ul className="mt-2 space-y-0.5">
              {clearance.items.map((i) => (
                <li key={i.key} className={itemStyle[i.state]}>
                  {i.detail}
                  {i.expiresOn && i.state !== "missing" && <> (until {formatDateOnly(i.expiresOn)})</>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-semibold">Background check (yearly)</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="background_check_date">Came back clear on</Label>
                <Input id="background_check_date" name="background_check_date" type="date" defaultValue={coach.background_check_date ?? ""} disabled={pending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="background_check_provider">Run by</Label>
                <Input id="background_check_provider" name="background_check_provider" placeholder="e.g. Sterling, DPS FACT" defaultValue={coach.background_check_provider ?? ""} disabled={pending} />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="background_check_sex_offender_registry" defaultChecked={!!coach.background_check_sex_offender_registry} disabled={pending} className="h-5 w-5" />
              Included the sex-offender registry (required)
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="background_check_fingerprint" defaultChecked={!!coach.background_check_fingerprint} disabled={pending} className="h-5 w-5" />
              Fingerprint-based (school districts may require this)
            </label>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-semibold">Abuse-prevention training (every 2 years)</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="abuse_training_date">Completed on</Label>
                <Input id="abuse_training_date" name="abuse_training_date" type="date" defaultValue={coach.abuse_training_date ?? ""} disabled={pending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="abuse_training_expires_on">Certificate expires (if shown)</Label>
                <Input id="abuse_training_expires_on" name="abuse_training_expires_on" type="date" defaultValue={coach.abuse_training_expires_on ?? ""} disabled={pending} />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cpr_first_aid_expires_on">CPR / First Aid expires</Label>
              <Input id="cpr_first_aid_expires_on" name="cpr_first_aid_expires_on" type="date" defaultValue={coach.cpr_first_aid_expires_on ?? ""} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code_of_conduct_signed_on">Code of conduct signed on</Label>
              <Input id="code_of_conduct_signed_on" name="code_of_conduct_signed_on" type="date" defaultValue={coach.code_of_conduct_signed_on ?? ""} disabled={pending} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="safeguarding_notes">Notes</Label>
            <Textarea id="safeguarding_notes" name="safeguarding_notes" rows={2} placeholder="Where the certificates are kept, renewal reminders…" defaultValue={coach.safeguarding_notes ?? ""} disabled={pending} />
          </div>

          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 grid grid-cols-2 gap-2 border-t bg-background px-6 pb-6 pt-3 sm:static sm:mx-0 sm:mb-0 sm:flex sm:justify-end sm:border-t-0 sm:px-0 sm:pb-0 sm:pt-2">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
