"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProgram, updateProgram } from "@/lib/actions/programs";
import type { Program, School } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface WebsiteListingOption {
  id: string;
  title: string;
  ops_program_id: string | null;
}

interface ProgramFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schools: School[];
  schoolId?: string;
  program?: Program;
  defaultValues?: Partial<Program>;
  /** Marketing-site listings this program can be shown as. */
  websiteListings?: WebsiteListingOption[];
}

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function ProgramFormDialog({
  open,
  onOpenChange,
  schools,
  schoolId,
  program,
  defaultValues,
  websiteListings = [],
}: ProgramFormDialogProps) {
  const router = useRouter();
  const isEditing = !!program;
  const defaults = program ?? defaultValues;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(
    defaults?.registration_open ?? false
  );

  // The listing currently pointing at this program, if any.
  const linkedListingId =
    websiteListings.find((l) => l.ops_program_id && l.ops_program_id === program?.id)?.id ?? "";

  const listingOptions = [
    { value: "", label: "Not shown on the website" },
    ...websiteListings
      // Hide listings already claimed by a different program.
      .filter((l) => !l.ops_program_id || l.ops_program_id === program?.id)
      .map((l) => ({ value: l.id, label: l.title })),
  ];

  const schoolOptions = schools.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const formData = new FormData(e.currentTarget);

      // If schoolId is pre-set via prop, ensure it's in the form data
      if (schoolId) {
        formData.set("school_id", schoolId);
      }

      const result = isEditing
        ? await updateProgram(program.id, formData)
        : await createProgram(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(
        isEditing ? "Program updated successfully" : "Program created successfully"
      );
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Program" : defaultValues ? "Duplicate Program" : "New Program"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the program details below."
              : defaultValues
                ? "Create a copy of this program. Choose the target school."
                : "Add a new program to a school."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* School selector - hidden when schoolId is provided */}
          {!schoolId && (
            <div className="space-y-2">
              <Label htmlFor="school_id">School</Label>
              <Select
                id="school_id"
                name="school_id"
                options={schoolOptions}
                placeholder="Select a school"
                defaultValue={defaults?.school_id ?? ""}
                required
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Program name */}
          <div className="space-y-2">
            <Label htmlFor="name">Program Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. After-School Soccer"
              defaultValue={defaults?.name ?? ""}
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Season */}
          <div className="space-y-2">
            <Label htmlFor="season">Season</Label>
            <Input
              id="season"
              name="season"
              placeholder="e.g. Spring 2026"
              defaultValue={defaults?.season ?? ""}
              disabled={isSubmitting}
            />
          </div>

          {/* Date fields side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                name="start_date"
                type="date"
                defaultValue={defaults?.start_date ?? ""}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                name="end_date"
                type="date"
                defaultValue={defaults?.end_date ?? ""}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Monthly fee and status side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="monthly_fee">Monthly Fee</Label>
              <Input
                id="monthly_fee"
                name="monthly_fee"
                type="number"
                min="0"
                step="0.01"
                placeholder="120.00"
                defaultValue={defaults?.monthly_fee ?? 120}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                name="status"
                options={statusOptions}
                defaultValue={defaults?.status ?? "upcoming"}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Registration — everything a parent sees */}
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Open registration</p>
                <p className="text-xs text-muted-foreground">
                  Gives this program a link parents can use to sign up themselves.
                  Anyone past the cap joins the waitlist.
                </p>
              </div>
              <Switch
                checked={registrationOpen}
                onCheckedChange={setRegistrationOpen}
                disabled={isSubmitting}
                aria-label="Open registration"
              />
            </div>
            {/* A Switch is a button, so its value has to be carried separately. */}
            <input
              type="hidden"
              name="registration_open"
              value={registrationOpen ? "true" : "false"}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="capacity">Spots</Label>
                <Input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={defaults?.capacity ?? 12}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  name="location"
                  placeholder="Where sessions happen"
                  defaultValue={defaults?.location ?? ""}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="public_description">Description for parents</Label>
              <Textarea
                id="public_description"
                name="public_description"
                placeholder="Shown on the registration page..."
                rows={2}
                defaultValue={defaults?.public_description ?? ""}
                disabled={isSubmitting}
              />
            </div>

            {websiteListings.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="website_listing_id">Show as website listing</Label>
                <Select
                  id="website_listing_id"
                  name="website_listing_id"
                  options={listingOptions}
                  defaultValue={linkedListingId}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                  Links this program to a listing on risingstars.training, so the site
                  shows real remaining spots instead of typed text.
                </p>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Optional notes about this program..."
              rows={3}
              defaultValue={defaults?.notes ?? ""}
              disabled={isSubmitting}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save Changes"
                  : "Create Program"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
