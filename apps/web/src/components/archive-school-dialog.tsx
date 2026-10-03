"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { archiveSchool } from "@/lib/actions/schools";
import { useAction } from "@/lib/use-action";

interface ArchiveSchoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  /** Children still enrolled in one of the school's programs. */
  activeStudents: number;
}

/**
 * Archiving stops the school's billing either way. Archiving used to leave
 * every child enrolled, so they stayed on the rosters and kept being invoiced.
 */
export function ArchiveSchoolDialog({ open, onOpenChange, schoolId, schoolName, activeStudents }: ArchiveSchoolDialogProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [endEnrollments, setEndEnrollments] = useState(true);

  async function archive() {
    const ok = await run(() => archiveSchool(schoolId, { endEnrollments: activeStudents > 0 && endEnrollments }), {
      success: "School archived",
      error: "Couldn't archive the school",
      refresh: false,
    });
    if (ok) router.push("/schools");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Archive {schoolName}?</DialogTitle>
          <DialogDescription>
            Families at an archived school are not sent any more invoices.
          </DialogDescription>
        </DialogHeader>

        {activeStudents > 0 && (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
            <div>
              <p id="end-enrollments-label" className="text-sm font-medium">
                End {activeStudents === 1 ? "the 1 child's place" : `all ${activeStudents} children's places`} here too
              </p>
              <p className="text-xs text-muted-foreground">
                They come off this school&apos;s rosters. Their payment history is kept.
              </p>
            </div>
            <Switch
              aria-labelledby="end-enrollments-label"
              checked={endEnrollments}
              onCheckedChange={setEndEnrollments}
              disabled={pending}
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={archive} disabled={pending}>
            {pending ? "Archiving..." : "Archive school"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
