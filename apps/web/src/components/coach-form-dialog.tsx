"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createCoach, updateCoach } from "@/lib/actions/coaches";
import { useAction } from "@/lib/use-action";
import type { Coach } from "@/types/database";

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "prospective", label: "Prospective" },
  { value: "inactive", label: "Inactive" },
];

const payTypeOptions = [
  { value: "per_session", label: "Per session" },
  { value: "hourly", label: "Hourly" },
];

export function CoachFormDialog({
  open,
  onOpenChange,
  coach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coach?: Coach;
}) {
  const { run, pending } = useAction();
  const isEditing = !!coach;
  const [payType, setPayType] = useState<string>(coach?.pay_type ?? "per_session");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const ok = isEditing
      ? await run(() => updateCoach(coach!.id, formData), {
          success: "Coach updated",
          error: "The coach wasn't updated",
        })
      : await run(() => createCoach(formData), {
          success: "Coach added",
          error: "The coach wasn't added",
        });

    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Coach" : "Add Coach"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                name="first_name"
                required
                defaultValue={coach?.first_name ?? ""}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                name="last_name"
                required
                defaultValue={coach?.last_name ?? ""}
                disabled={pending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                required
                placeholder="(214) 555-0123"
                defaultValue={coach?.phone ?? ""}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={coach?.email ?? ""}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pay_type">Paid</Label>
                <Select
                  id="pay_type"
                  name="pay_type"
                  options={payTypeOptions}
                  value={payType}
                  onChange={(e) => setPayType(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay_rate">
                  {payType === "hourly" ? "Rate per hour" : "Rate per session"}
                </Label>
                <Input
                  id="pay_rate"
                  name="pay_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="40.00"
                  defaultValue={coach?.pay_rate ?? ""}
                  disabled={pending}
                />
              </div>
            </div>
            {payType === "hourly" && (
              <p className="text-xs text-muted-foreground">
                Nothing records hours yet, so what an hourly coach is owed has to be
                worked out by hand. Per-session totals itself.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                name="status"
                options={statusOptions}
                defaultValue={coach?.status ?? "active"}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Found via</Label>
              <Input
                id="source"
                name="source"
                placeholder="Facebook, referral…"
                defaultValue={coach?.source ?? ""}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Which sports, availability, anything to remember…"
              defaultValue={coach?.notes ?? ""}
              disabled={pending}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEditing
                  ? "Saving..."
                  : "Adding..."
                : isEditing
                  ? "Save Changes"
                  : "Add Coach"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
