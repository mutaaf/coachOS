"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { linkParentToStudent, unlinkParentFromStudent } from "@/lib/actions/students";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { Parent } from "@/types/database";

interface LinkedParent extends Parent {
  relationship: string;
}

interface LinkParentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  linkedParents: LinkedParent[];
  allParents: Parent[];
}

export function LinkParentDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  linkedParents,
  allParents,
}: LinkParentDialogProps) {
  const router = useRouter();
  const [selectedParentId, setSelectedParentId] = useState("");
  const [relationship, setRelationship] = useState("mother");
  const [loading, setLoading] = useState(false);

  const linkedParentIds = new Set(linkedParents.map((p) => p.id));
  const availableParents = allParents.filter((p) => !linkedParentIds.has(p.id));

  async function handleLink() {
    if (!selectedParentId) return;
    setLoading(true);
    const result = await linkParentToStudent(studentId, selectedParentId, relationship);
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Parent linked");
      setSelectedParentId("");
      router.refresh();
    }
  }

  async function handleUnlink(parentId: string) {
    const result = await unlinkParentFromStudent(studentId, parentId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Parent unlinked");
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Link Parents — {studentName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Current linked parents */}
          {linkedParents.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Linked Parents</p>
              {linkedParents.map((parent) => (
                <div key={parent.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <span className="text-sm font-medium">{parent.first_name} {parent.last_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">({parent.relationship})</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleUnlink(parent.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No parents linked yet.</p>
          )}

          {/* Link new parent */}
          {availableParents.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm font-medium text-muted-foreground">Add Parent</p>
              <Select
                value={selectedParentId}
                onChange={(e) => setSelectedParentId(e.target.value)}
                placeholder="Select a parent..."
                options={availableParents.map((p) => ({
                  value: p.id,
                  label: `${p.first_name} ${p.last_name} (${p.phone})`,
                }))}
              />
              <Select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                options={[
                  { value: "mother", label: "Mother" },
                  { value: "father", label: "Father" },
                  { value: "guardian", label: "Guardian" },
                  { value: "other", label: "Other" },
                ]}
              />
              <Button onClick={handleLink} disabled={!selectedParentId || loading} size="sm" className="w-full">
                {loading ? "Linking..." : "Link Parent"}
              </Button>
            </div>
          )}

          {availableParents.length === 0 && linkedParents.length > 0 && (
            <p className="text-xs text-muted-foreground pt-2 border-t">All parents are already linked.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
