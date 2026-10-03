"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createStudent, updateStudent } from "@/lib/actions/students";
import type { Student } from "@/types/database";
import { GraduationCap } from "lucide-react";
import { SamePersonPrompt, childMatches, type SameMatch } from "@/components/same-person-prompt";

interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student;
}

const gradeOptions = [
  { value: "", label: "Select grade" },
  { value: "Pre-K", label: "Pre-K" },
  { value: "K", label: "Kindergarten" },
  { value: "1", label: "1st Grade" },
  { value: "2", label: "2nd Grade" },
  { value: "3", label: "3rd Grade" },
  { value: "4", label: "4th Grade" },
  { value: "5", label: "5th Grade" },
  { value: "6", label: "6th Grade" },
  { value: "7", label: "7th Grade" },
  { value: "8", label: "8th Grade" },
  { value: "9", label: "9th Grade" },
  { value: "10", label: "10th Grade" },
  { value: "11", label: "11th Grade" },
  { value: "12", label: "12th Grade" },
];

export function StudentFormDialog({
  open,
  onOpenChange,
  student,
}: StudentFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const isEditing = !!student;
  // Someone of this name already on file: the form waits on "Is this the same…?"
  const [asking, setAsking] = useState<{ formData: FormData; matches: SameMatch[] } | null>(null);

  useEffect(() => {
    if (!open) setAsking(null);
  }, [open]);

  function save(formData: FormData) {
    const name = `${formData.get("first_name")} ${formData.get("last_name")}`;
    startTransition(async () => {
      const result = isEditing
        ? await updateStudent(student.id, formData)
        : await createStudent(formData);

      if ("matches" in result && result.matches) {
        setAsking({ formData, matches: childMatches(result.matches) });
        return;
      }
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(
        isEditing
          ? `${name} updated`
          : "existing" in result && result.existing
            ? `${name} was already on file — updated, not added again`
            : `${name} added`
      );
      setAsking(null);
      onOpenChange(false);
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save(new FormData(e.currentTarget));
  }

  function answer(field: "existing_student_id" | "confirm_new", value: string) {
    if (!asking) return;
    const formData = new FormData();
    asking.formData.forEach((v, k) => formData.set(k, v));
    formData.set(field, value);
    save(formData);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            {isEditing ? "Edit Student" : "Add Student"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the student's information."
              : "Add a new student to your roster."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">
                First Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="first_name"
                name="first_name"
                required
                placeholder="First name"
                defaultValue={student?.first_name || ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">
                Last Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="last_name"
                name="last_name"
                required
                placeholder="Last name"
                defaultValue={student?.last_name || ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="grade">Grade</Label>
              <Select
                id="grade"
                name="grade"
                options={gradeOptions}
                defaultValue={student?.grade || ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date_of_birth">Date of Birth</Label>
              <Input
                id="date_of_birth"
                name="date_of_birth"
                type="date"
                defaultValue={student?.date_of_birth || ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="medical_notes">Medical Notes</Label>
            <Textarea
              id="medical_notes"
              name="medical_notes"
              placeholder="Allergies, conditions, medications..."
              rows={2}
              defaultValue={student?.medical_notes || ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Additional notes..."
              rows={2}
              defaultValue={student?.notes || ""}
            />
          </div>

          {asking && (
            <SamePersonPrompt
              question={`Is this the same ${asking.formData.get("first_name")}?`}
              matches={asking.matches}
              sameLabel="Yes, same child"
              newLabel="No, add a new child"
              onSame={(id) => answer("existing_student_id", id)}
              onNew={() => answer("confirm_new", "1")}
              onBack={() => setAsking(null)}
              disabled={isPending}
            />
          )}

          <div className={asking ? "hidden" : "flex justify-end gap-3 pt-2"}>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? isEditing
                  ? "Saving..."
                  : "Adding..."
                : isEditing
                  ? "Save Changes"
                  : "Add Student"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
