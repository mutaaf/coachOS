"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { enrollStudent } from "@/lib/actions/students";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface EnrollStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
}

export function EnrollStudentDialog({ open, onOpenChange, studentId, studentName }: EnrollStudentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [programs, setPrograms] = useState<{ value: string; label: string }[]>([]);
  const [selectedProgram, setSelectedProgram] = useState("");

  useEffect(() => {
    if (open) {
      const supabase = createClient();
      supabase
        .from("programs")
        .select("id, name, schools(name)")
        .eq("status", "active")
        .then(({ data }) => {
          if (data) {
            setPrograms(
              data.map((p: any) => ({
                value: p.id,
                label: `${p.schools?.name || "Unknown"} — ${p.name}`,
              }))
            );
          }
        });
    }
  }, [open]);

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
            options={programs}
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
