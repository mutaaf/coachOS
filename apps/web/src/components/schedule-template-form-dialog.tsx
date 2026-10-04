"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createScheduleTemplate,
  updateScheduleTemplate,
} from "@/lib/actions/schedule";
import type { ScheduleTemplate } from "@/types/database";
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

interface ScheduleTemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programs: { id: string; name: string }[];
  /** Active coaches, for naming who normally runs this slot. */
  coaches?: { id: string; first_name: string; last_name: string }[];
  template?: ScheduleTemplate;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleTemplateFormDialog({
  open,
  onOpenChange,
  programs,
  coaches = [],
  template,
}: ScheduleTemplateFormDialogProps) {
  const router = useRouter();
  const isEditing = !!template;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  useEffect(() => {
    if (open) {
      setSelectedDays(template ? [template.day_of_week] : []);
    }
  }, [open, template]);

  const programOptions = programs.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  function toggleDay(day: number) {
    if (isEditing) {
      // Edit mode: single select only
      setSelectedDays([day]);
      return;
    }
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (selectedDays.length === 0) {
      toast.error("Please select at least one day.");
      return;
    }

    setIsSubmitting(true);

    try {
      const form = e.currentTarget;

      if (isEditing) {
        const formData = new FormData(form);
        formData.set("day_of_week", String(selectedDays[0]));
        const result = await updateScheduleTemplate(template.id, formData);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Schedule template updated");
      } else {
        let created = 0;
        for (const day of selectedDays) {
          const formData = new FormData(form);
          formData.set("day_of_week", String(day));
          const result = await createScheduleTemplate(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          created++;
        }
        toast.success(`Created ${created} schedule template(s)`);
      }

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
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>
            {isEditing ? "Edit Schedule Template" : "New Schedule Template"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the schedule template details below."
              : "Add a weekly practice time for a session. Select multiple days to create one template per day."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="program_id">Session</Label>
            <Select
              id="program_id"
              name="program_id"
              options={programOptions}
              placeholder="Select a session"
              defaultValue={template?.program_id ?? ""}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label>Day{isEditing ? " of Week" : "s of Week"}</Label>
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LABELS.map((label, i) => {
                const active = selectedDays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => toggleDay(i)}
                    aria-pressed={active}
                    className={`h-11 rounded-lg border px-0 text-xs font-medium cursor-pointer transition-colors sm:h-9 ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-input hover:bg-accent"
                    } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_time">Start Time</Label>
              <Input
                id="start_time"
                name="start_time"
                type="time"
                defaultValue={template?.start_time?.slice(0, 5) ?? ""}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">End Time</Label>
              <Input
                id="end_time"
                name="end_time"
                type="time"
                defaultValue={template?.end_time?.slice(0, 5) ?? ""}
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          {coaches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="coach_id">Coach (optional)</Label>
              <Select
                id="coach_id"
                name="coach_id"
                options={[
                  { value: "", label: "Not assigned" },
                  ...coaches.map((c) => ({
                    value: c.id,
                    label: `${c.first_name} ${c.last_name}`,
                  })),
                  // Without this, a coach since made inactive fell back to
                  // "Not assigned" and saving cleared them.
                  ...(template?.coach_id && !coaches.some((c) => c.id === template.coach_id)
                    ? [{ value: template.coach_id, label: "A coach no longer active" }]
                    : []),
                ]}
                defaultValue={template?.coach_id ?? ""}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Who normally runs this slot. Each practice can be changed
                individually when someone covers.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              name="location"
              placeholder="e.g. Main Gym, Field A"
              defaultValue={template?.location ?? ""}
              disabled={isSubmitting}
            />
          </div>

          {isEditing && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="update_future"
                className="mt-0.5 h-5 w-5 shrink-0"
                defaultChecked
                disabled={isSubmitting}
              />
              <span>
                Also change the practices already on the calendar. Past and
                cancelled practices stay as they were, and so does anyone
                covering a practice.
              </span>
            </label>
          )}

          {/* Pinned to the bottom of the dialog on phones so the keyboard or a
              long form never hides it. */}
          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 grid grid-cols-2 gap-2 border-t bg-background px-6 pb-6 pt-3 sm:static sm:mx-0 sm:mb-0 sm:flex sm:justify-end sm:border-t-0 sm:px-0 sm:pb-0 sm:pt-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={isSubmitting || selectedDays.length === 0}>
              {isSubmitting
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save Changes"
                  : selectedDays.length > 1
                    ? `Create ${selectedDays.length} Templates`
                    : "Create Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
