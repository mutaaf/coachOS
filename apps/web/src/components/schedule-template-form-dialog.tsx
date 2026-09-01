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
  template?: ScheduleTemplate;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleTemplateFormDialog({
  open,
  onOpenChange,
  programs,
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
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Schedule Template" : "New Schedule Template"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the schedule template details below."
              : "Add a recurring schedule for a program. Select multiple days to create one template per day."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="program_id">Program</Label>
            <Select
              id="program_id"
              name="program_id"
              options={programOptions}
              placeholder="Select a program"
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
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
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

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || selectedDays.length === 0}>
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
