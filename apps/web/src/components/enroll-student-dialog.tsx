"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SelectGroup } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { enrollStudent } from "@/lib/actions/students";
import { useAction } from "@/lib/use-action";
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
  const { run, pending } = useAction();
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
    // A full program or an existing enrollment comes back as a returned error,
    // not a thrown one, so this used to report success either way.
    const ok = await run(() => enrollStudent(studentId, selectedProgram), {
      success: `${studentName} enrolled`,
      error: `${studentName} wasn't enrolled`,
    });
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="break-words pr-6 leading-snug">Enroll {studentName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">Select a session to enroll this student in.</p>
          <Select
            groups={programGroups}
            aria-label="Session"
            className="h-11 text-base sm:h-10 sm:text-sm"
            placeholder="Select a session"
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            required
          />
          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-background px-6 pb-6 pt-3 sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:justify-end sm:gap-3 sm:border-0 sm:px-0 sm:pb-0 sm:pt-2">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={pending || !selectedProgram}>
              {pending ? "Enrolling..." : "Enroll"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
