"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SelectGroup } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { enrollStudent } from "@/lib/actions/students";
import { toast } from "sonner";
import type { EnrollableProgram } from "@/lib/queries/programs";

export type { EnrollableProgram };

interface EnrollStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  programs: EnrollableProgram[];
  studentEnrolledProgramIds: string[];
  schoolId?: string;
}

export function EnrollStudentDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  programs,
  studentEnrolledProgramIds,
  schoolId,
}: EnrollStudentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState("");

  const programGroups = useMemo(() => {
    const filtered = schoolId
      ? programs.filter((p) => p.school_id === schoolId)
      : programs;

    const enrolledSet = new Set(studentEnrolledProgramIds);

    const schoolMap = new Map<string, { name: string; options: SelectGroup["options"] }>();

    for (const p of filtered) {
      const schoolName = p.school?.name || "Unknown School";
      const key = p.school_id || schoolName;

      if (!schoolMap.has(key)) {
        schoolMap.set(key, { name: schoolName, options: [] });
      }

      const isEnrolled = enrolledSet.has(p.id);
      const statusLabel = p.status === "upcoming" ? " (upcoming)" : "";

      schoolMap.get(key)!.options.push({
        value: p.id,
        label: `${p.name}${statusLabel}${isEnrolled ? " (enrolled)" : ""}`,
        disabled: isEnrolled,
      });
    }

    return Array.from(schoolMap.values()).map((s) => ({
      label: s.name,
      options: s.options,
    }));
  }, [programs, studentEnrolledProgramIds, schoolId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProgram) return;
    setLoading(true);
    try {
      await enrollStudent(studentId, selectedProgram);
      toast.success(`${studentName} enrolled successfully`);
      onOpenChange(false);
    } catch {
      toast.error("Failed to enroll student. They may already be enrolled.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Enroll {studentName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">Select a program to enroll this student in.</p>
          <Select
            groups={programGroups}
            placeholder="Select a program"
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !selectedProgram}>
              {loading ? "Enrolling..." : "Enroll"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
