"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordAttendance, cancelSession, completeSession } from "@/lib/actions/schedule";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Check, X, Clock, AlertCircle, Users } from "lucide-react";

type AttendanceStatus = "present" | "absent" | "late" | "excused";

interface AttendanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: any;
}

const statusStyles: Record<AttendanceStatus, { bg: string; text: string; icon: any }> = {
  present: { bg: "bg-green-100", text: "text-green-700", icon: Check },
  absent: { bg: "bg-red-100", text: "text-red-700", icon: X },
  late: { bg: "bg-orange-100", text: "text-orange-700", icon: Clock },
  excused: { bg: "bg-gray-100", text: "text-gray-700", icon: AlertCircle },
};

export function AttendanceDialog({ open, onOpenChange, session }: AttendanceDialogProps) {
  const [students, setStudents] = useState<any[]>([]);
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    if (open && session) {
      const supabase = createClient();
      // Get enrolled students for this program
      supabase
        .from("enrollments")
        .select("*, students(*)")
        .eq("program_id", session.program_id)
        .eq("status", "active")
        .then(({ data }) => {
          const enrolled = (data || []).map((e: any) => e.students).filter(Boolean);
          setStudents(enrolled);
        });
      // Get existing attendance
      supabase
        .from("attendance")
        .select("*")
        .eq("session_id", session.id)
        .then(({ data }) => {
          const map: Record<string, AttendanceStatus> = {};
          (data || []).forEach((a: any) => { map[a.student_id] = a.status; });
          setRecords(map);
        });
    }
  }, [open, session]);

  function toggleStatus(studentId: string) {
    const order: AttendanceStatus[] = ["present", "absent", "late", "excused"];
    const current = records[studentId] || "present";
    const next = order[(order.indexOf(current) + 1) % order.length];
    setRecords({ ...records, [studentId]: next });
  }

  async function handleSave() {
    setLoading(true);
    try {
      const attendanceRecords = students.map((s) => ({
        studentId: s.id,
        status: records[s.id] || ("present" as AttendanceStatus),
      }));
      await recordAttendance(session.id, attendanceRecords);
      toast.success("Attendance saved");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save attendance");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelSession(session.id, cancelReason);
      toast.success("Session cancelled");
      onOpenChange(false);
    } catch {
      toast.error("Failed to cancel session");
    }
  }

  async function handleComplete() {
    try {
      await completeSession(session.id);
      toast.success("Session marked complete");
      onOpenChange(false);
    } catch {
      toast.error("Failed to complete session");
    }
  }

  const program = session?.programs;
  const school = program?.schools;
  const presentCount = Object.values(records).filter((s) => s === "present" || s === "late").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Session Details</DialogTitle>
        </DialogHeader>

        {/* Session Info */}
        <div className="rounded-xl bg-muted/50 p-4 space-y-1 text-sm">
          <div className="font-medium">{program?.name}</div>
          <div className="text-muted-foreground">{school?.name}</div>
          <div className="text-muted-foreground">
            {new Date(session.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            {" "}at {session.start_time?.slice(0, 5)} — {session.end_time?.slice(0, 5)}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant={session.status === "cancelled" ? "destructive" : session.status === "completed" ? "success" : "secondary"}>
              {session.status}
            </Badge>
            <span className="text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {presentCount}/{students.length}
            </span>
          </div>
        </div>

        {/* Attendance List */}
        {session.status === "scheduled" && (
          <>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {students.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No students enrolled in this program.</p>
              ) : (
                students.map((student) => {
                  const status = records[student.id] || "present";
                  const style = statusStyles[status];
                  const Icon = style.icon;
                  return (
                    <button
                      key={student.id}
                      className="w-full flex items-center justify-between p-3 rounded-xl border hover:bg-muted/30 transition-colors"
                      onClick={() => toggleStatus(student.id)}
                    >
                      <span className="font-medium text-sm">{student.first_name} {student.last_name}</span>
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                        <Icon className="h-3.5 w-3.5" /> {status}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">Click a student to cycle through status</p>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" className="text-red-600" onClick={() => setShowCancel(!showCancel)}>
                Cancel Session
              </Button>
              <Button variant="outline" size="sm" onClick={handleComplete}>
                Mark Complete
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading} className="ml-auto">
                {loading ? "Saving..." : "Save Attendance"}
              </Button>
            </div>

            {showCancel && (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                  placeholder="Reason (optional)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Button size="sm" variant="destructive" onClick={handleCancel}>Confirm Cancel</Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
