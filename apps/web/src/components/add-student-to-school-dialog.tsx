"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { createStudent, enrollStudent } from "@/lib/actions/students";
import type { Program } from "@/types/database";

interface AddStudentToSchoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  programs: Program[];
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

export function AddStudentToSchoolDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  programs,
}: AddStudentToSchoolDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [allStudents, setAllStudents] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");

  const activePrograms = programs.filter((p) => p.status === "active" || p.status === "upcoming");
  const programOptions = activePrograms.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  // Load all students from DB when dialog is open in "existing" mode
  // Re-fetches when switching back from "new" to pick up recently created students
  useEffect(() => {
    if (open && mode === "existing") {
      const supabase = createClient();
      supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("status", "active")
        .order("last_name")
        .then(({ data }) => {
          if (data) {
            setAllStudents(
              data.map((s) => ({
                value: s.id,
                label: `${s.first_name} ${s.last_name}`,
              }))
            );
          }
        });
    }
  }, [open, mode]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setMode("existing");
      setSelectedStudentId("");
      setSelectedProgramId("");
    }
  }, [open]);

  function handleClose() {
    onOpenChange(false);
    router.refresh();
  }

  // Enroll an existing student
  async function handleEnrollExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudentId || !selectedProgramId) return;

    startTransition(async () => {
      const result = await enrollStudent(selectedStudentId, selectedProgramId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const studentLabel =
        allStudents.find((s) => s.value === selectedStudentId)?.label || "Student";
      toast.success(`${studentLabel} enrolled successfully`);
      handleClose();
    });
  }

  // Create new student and enroll
  async function handleCreateAndEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const programId = formData.get("program_id") as string;

    if (!programId) {
      toast.error("Please select a program");
      return;
    }

    startTransition(async () => {
      // Create the student
      const createResult = await createStudent(formData);
      if (createResult.error) {
        toast.error(createResult.error);
        return;
      }

      const newStudentId = createResult.data?.id;
      if (!newStudentId) {
        toast.error("Failed to create student");
        return;
      }

      // Enroll in the selected program
      const enrollResult = await enrollStudent(newStudentId, programId);
      if (enrollResult.error) {
        toast.error(enrollResult.error);
        return;
      }

      const name = `${formData.get("first_name")} ${formData.get("last_name")}`;
      toast.success(`${name} created and enrolled`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Student to {schoolName}</DialogTitle>
          <DialogDescription>
            Select an existing student or create a new one, then enroll them in a
            program.
          </DialogDescription>
        </DialogHeader>

        {/* Mode Toggle */}
        <div className="flex gap-1 rounded-lg bg-muted p-1 mt-2">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "existing"
                ? "bg-white shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Existing Student
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "new"
                ? "bg-white shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            New Student
          </button>
        </div>

        {mode === "existing" ? (
          /* ---- Existing Student Mode ---- */
          <form onSubmit={handleEnrollExisting} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label>Student</Label>
              <Select
                options={allStudents}
                placeholder="Select a student"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                required
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>Program</Label>
              {programOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
                  No active programs at this school. Create a program first from the Overview tab.
                </p>
              ) : (
                <Select
                  options={programOptions}
                  placeholder="Select a program"
                  value={selectedProgramId}
                  onChange={(e) => setSelectedProgramId(e.target.value)}
                  required
                  disabled={isPending}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || !selectedStudentId || !selectedProgramId || programOptions.length === 0}
              >
                {isPending ? "Enrolling..." : "Enroll Student"}
              </Button>
            </div>
          </form>
        ) : (
          /* ---- New Student Mode ---- */
          <form onSubmit={handleCreateAndEnroll} className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name">
                  First Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="first_name"
                  name="first_name"
                  required
                  placeholder="First name"
                  disabled={isPending}
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
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="grade">Grade</Label>
                <Select
                  id="grade"
                  name="grade"
                  options={gradeOptions}
                  defaultValue=""
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date_of_birth">Date of Birth</Label>
                <Input
                  id="date_of_birth"
                  name="date_of_birth"
                  type="date"
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medical_notes">Medical Notes</Label>
              <Textarea
                id="medical_notes"
                name="medical_notes"
                placeholder="Allergies, conditions..."
                rows={2}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Program <span className="text-destructive">*</span>
              </Label>
              {programOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
                  No active programs at this school. Create a program first from the Overview tab.
                </p>
              ) : (
                <Select
                  name="program_id"
                  options={programOptions}
                  placeholder="Select a program"
                  required
                  disabled={isPending}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || programOptions.length === 0}>
                {isPending ? "Creating..." : "Create & Enroll"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
