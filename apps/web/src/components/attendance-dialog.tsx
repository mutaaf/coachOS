"use client";

import { useState, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordAttendance, cancelSession, completeSession } from "@/lib/actions/schedule";
import { createClient } from "@/lib/supabase/client";
import { useAction } from "@/lib/use-action";
import { createAttendanceLink } from "@/lib/actions/attendance-links";
import { assignCoachToSession } from "@/lib/actions/coaches";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { businessToday, formatBusinessTime, formatDateOnly, sessionDayPhrase } from "@/lib/dates";
import { toast } from "sonner";
import { Link2, Copy, ExternalLink } from "lucide-react";
import { Check, X, Clock, AlertCircle, Users } from "lucide-react";
import { CoachClearanceBadge } from "@/components/coach-clearance-badge";
import type { CoachClearance } from "@/lib/coach-clearance";

type AttendanceStatus = "present" | "absent" | "late" | "excused";

interface AttendanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: any;
  /** Active coaches, for naming who runs this practice. */
  coaches?: { id: string; first_name: string; last_name: string; cleared?: boolean; clearance?: CoachClearance }[];
  /** Called once a new coach is saved, so the calendar keeps it. */
  onCoachChange?: (coachId: string | null) => void;
}

const statusStyles: Record<AttendanceStatus, { bg: string; text: string; icon: any }> = {
  present: { bg: "bg-green-100", text: "text-green-700", icon: Check },
  absent: { bg: "bg-red-100", text: "text-red-700", icon: X },
  late: { bg: "bg-orange-100", text: "text-orange-700", icon: Clock },
  excused: { bg: "bg-gray-100", text: "text-gray-700", icon: AlertCircle },
};

export function AttendanceDialog({ open, onOpenChange, session, coaches = [], onCoachChange }: AttendanceDialogProps) {
  const [students, setStudents] = useState<any[]>([]);
  const [attended, setAttended] = useState<any[]>([]);
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  // The roster arrives after the dialog opens; without this the list flashes
  // from empty to full and it looks like nobody is enrolled.
  const [rosterLoading, setRosterLoading] = useState(true);
  // Children sitting out after a suspected concussion, until a doctor clears them.
  const [sittingOut, setSittingOut] = useState<Set<string>>(new Set());
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const { run, pending } = useAction();
  // Shown once, right after issuing — the passcode is hashed and cannot be
  // read back, so this is the only chance to copy it.
  const [coachLink, setCoachLink] = useState<{ url: string; passcode: string; expiresAt: string } | null>(null);
  const coachLinkRef = useRef<HTMLDivElement>(null);

  // The link appears above the register, while the button that makes it sits
  // at the bottom — bring it into view so it isn't missed on a phone.
  useEffect(() => {
    if (coachLink) coachLinkRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [coachLink]);

  useEffect(() => {
    if (open && session) {
      setRosterLoading(true);
      setAttended([]);
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
          setRosterLoading(false);
        });
      supabase
        .from("incidents")
        .select("student_id, occurred_at")
        .eq("concussion_suspected", true)
        .is("cleared_to_return_at", null)
        .then(({ data }) => {
          const onDay = (data || []).filter(
            (i: any) => i.student_id && new Date(i.occurred_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) <= session.date
          );
          setSittingOut(new Set(onDay.map((i: any) => i.student_id as string)));
        });
      // Get existing attendance. Children on it who have since left still
      // belong on a finished practice's register.
      supabase
        .from("attendance")
        .select("*, students(*)")
        .eq("session_id", session.id)
        .then(({ data }) => {
          const map: Record<string, AttendanceStatus> = {};
          (data || []).forEach((a: any) => { map[a.student_id] = a.status; });
          setRecords(map);
          setAttended((data || []).map((a: any) => a.students).filter(Boolean));
        });
    }
  }, [open, session]);

  const completed = session?.status === "completed";
  // Completing a practice weeks away is how a register got lost for one that
  // hadn't happened. The server refuses too.
  const upcoming = session?.status === "scheduled" && session.date > businessToday();
  const roster = completed
    ? [...students, ...attended.filter((a) => !students.some((s) => s.id === a.id))]
    : students;

  // On a finished practice a child nobody marked is shown as such, not
  // assumed present — that would invent attendance after the fact.
  function statusOf(studentId: string): AttendanceStatus | null {
    return records[studentId] || (completed ? null : sittingOut.has(studentId) ? "excused" : "present");
  }

  function toggleStatus(studentId: string) {
    const order: AttendanceStatus[] = ["present", "absent", "late", "excused"];
    const current = statusOf(studentId);
    const next = current ? order[(order.indexOf(current) + 1) % order.length] : "present";
    setRecords({ ...records, [studentId]: next });
  }

  function registerOnScreen() {
    return roster
      .map((s) => ({ studentId: s.id as string, status: statusOf(s.id) }))
      .filter((r): r is { studentId: string; status: AttendanceStatus } => r.status !== null);
  }

  // Each of these only closes the dialog if the write actually succeeded.
  // They used to close either way, so a failed save looked identical to a
  // successful one and the register was quietly wrong.
  async function handleSave() {
    const ok = await run(() => recordAttendance(session.id, registerOnScreen()), {
      success: "Attendance saved",
      error: "Attendance wasn't saved",
    });
    if (ok) onOpenChange(false);
  }

  async function handleCancel() {
    const ok = await run(() => cancelSession(session.id, cancelReason), {
      success: "Practice cancelled",
      error: "The practice wasn't cancelled",
    });
    if (ok) onOpenChange(false);
  }

  async function issueCoachLink() {
    const result = await createAttendanceLink(session.id);
    if (result.error) {
      toast.error("Couldn't create the link", { description: result.error });
      return;
    }
    setCoachLink({
      url: `${window.location.origin}/s/${result.token}`,
      passcode: result.passcode!,
      expiresAt: result.expiresAt!,
    });
  }

  function copyCoachLink() {
    if (!coachLink) return;
    navigator.clipboard.writeText(
      `Register for ${sessionDayPhrase(session.date)}:\n${coachLink.url}\nPasscode: ${coachLink.passcode}`
    );
    toast.success("Link and passcode copied");
  }

  // Who ran this practice is what coach pay counts, so someone covering is
  // set here rather than on the weekly slot.
  async function handleCoachChange(value: string) {
    const coachId = value || null;
    const ok = await run(() => assignCoachToSession(session.id, coachId), {
      success: "Coach saved",
      error: "The coach wasn't saved",
    });
    if (ok) onCoachChange?.(coachId);
  }

  // A coach since made inactive is still who ran it, so keep them in the list.
  const coachOptions = [
    { value: "", label: "Not assigned" },
    ...coaches.map((c) => ({
      value: c.id,
      label: `${c.first_name} ${c.last_name}${c.cleared === false ? " — not cleared" : ""}`,
    })),
    ...(session?.coach_id && !coaches.some((c) => c.id === session.coach_id)
      ? [{ value: session.coach_id as string, label: "A coach no longer active" }]
      : []),
  ];

  // Saves the register and completes in one step. Completing used to be its
  // own button that ignored the register, so pressing it first lost the lot.
  async function handleComplete() {
    const ok = await run(() => completeSession(session.id, registerOnScreen()), {
      success: "Attendance saved and practice complete",
      error: "The practice wasn't completed",
    });
    if (ok) onOpenChange(false);
  }

  // The schedule's queries reshape the join to `program.school`; reading only
  // the raw `programs.schools` left the summary without a name or school.
  const program = session?.program ?? session?.programs;
  const school = program?.school ?? program?.schools;
  const presentCount = roster.filter((s) => {
    const status = statusOf(s.id);
    return status === "present" || status === "late";
  }).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Practice details</DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Session Info */}
          <div data-testid="session-summary" className="rounded-xl bg-muted/50 p-4 space-y-1 text-sm">
            {program?.name && <div className="font-medium break-words">{program.name}</div>}
            {school?.name && <div className="text-muted-foreground break-words">{school.name}</div>}
            <div className="text-muted-foreground tabular-nums">
              {formatDateOnly(session.date, { weekday: "long", month: "long", day: "numeric" })}
              {" "}at {session.start_time?.slice(0, 5)} — {session.end_time?.slice(0, 5)}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Badge variant={session.status === "cancelled" ? "destructive" : session.status === "completed" ? "success" : "secondary"}>
                {session.status}
              </Badge>
              <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
                <Users className="h-3.5 w-3.5" /> {presentCount}/{roster.length}
              </span>
            </div>
          </div>

          {(coaches.length > 0 || session.coach_id) && (
            <div className="flex items-center gap-3">
              <Label htmlFor="session_coach" className="shrink-0">Coach</Label>
              <div className="min-w-0 flex-1">
                <Select
                  id="session_coach"
                  options={coachOptions}
                  value={session.coach_id ?? ""}
                  onChange={(e) => handleCoachChange(e.target.value)}
                  disabled={pending}
                  className="h-11 text-base sm:h-10 sm:text-sm"
                />
              </div>
            </div>
          )}
          <CoachClearanceBadge warning clearance={coaches.find((c) => c.id === session.coach_id)?.clearance} />

          {/* Attendance List — kept on a completed practice so it can be checked and corrected */}
          {session.status !== "cancelled" && (
            <>
              {coachLink && (
                <div ref={coachLinkRef} className="rounded-xl border border-green-200 bg-green-50 p-3 space-y-2">
                  <p className="text-sm font-medium text-green-900">
                    Send this to the coach
                  </p>
                  <p className="break-all font-mono text-xs text-green-900">{coachLink.url}</p>
                  <p className="font-mono text-lg font-semibold tracking-[0.2em] text-green-900 tabular-nums">
                    {coachLink.passcode}
                  </p>
                  <p className="text-xs text-green-800">
                    Works until {formatBusinessTime(coachLink.expiresAt)}. The passcode isn&apos;t shown again — copy it now.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button size="sm" variant="outline" onClick={copyCoachLink} className="h-11 w-full sm:h-9">
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy link and passcode
                    </Button>
                    {/* Opens the coach's own register, e.g. when the Boss is
                        taking it herself courtside. */}
                    <a
                      href={coachLink.url}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm", className: "h-11 w-full sm:h-9" })}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open register
                    </a>
                  </div>
                </div>
              )}

              <div className="space-y-2 sm:max-h-64 sm:overflow-y-auto">
                {rosterLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-12 rounded-xl border bg-muted/40 animate-pulse" />
                    ))}
                  </div>
                ) : roster.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No students enrolled in this session.</p>
                ) : (
                  roster.map((student) => {
                    const status = statusOf(student.id);
                    const style = status ? statusStyles[status] : null;
                    const Icon = style?.icon;
                    return (
                      <button
                        key={student.id}
                        data-testid="register-row"
                        className="w-full min-h-[48px] flex items-center justify-between gap-3 p-3 rounded-xl border text-left hover:bg-muted/30 active:bg-muted/50 transition-colors"
                        onClick={() => toggleStatus(student.id)}
                      >
                        <span className="min-w-0 truncate font-medium text-sm">
                          {student.first_name} {student.last_name}
                          {sittingOut.has(student.id) && (
                            <span className="block text-xs font-normal text-red-700">
                              Sitting out: suspected concussion, no doctor&apos;s clearance yet
                            </span>
                          )}
                        </span>
                        {style && Icon ? (
                          <span className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                            <Icon className="h-3.5 w-3.5" /> {status}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border border-dashed text-muted-foreground">
                            not marked
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">Click a student to cycle through status</p>
            </>
          )}
        </div>

        {/* Actions stay pinned to the bottom of the dialog on phones, so the
            register can be long without pushing Save out of reach. */}
        {session.status !== "cancelled" && (
          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-4 space-y-2 border-t bg-background px-6 pb-6 pt-3 sm:static sm:mx-0 sm:mb-0 sm:border-t-0 sm:px-0 sm:pb-0 sm:pt-2">
            {completed ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={pending || registerOnScreen().length === 0}
                  className="h-11 w-full sm:ml-auto sm:h-9 sm:w-auto"
                >
                  {pending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  size="sm"
                  onClick={handleComplete}
                  disabled={pending || upcoming}
                  className="col-span-2 h-11 sm:order-last sm:ml-auto sm:h-9"
                >
                  {pending ? "Saving..." : "Save & complete"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 text-red-600 sm:h-9"
                  onClick={() => setShowCancel(!showCancel)}
                >
                  Cancel practice
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-9"
                  onClick={issueCoachLink}
                  disabled={pending}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  Coach link
                </Button>
              </div>
            )}
            {upcoming && (
              <p className="text-xs text-muted-foreground text-center">
                This practice hasn&apos;t happened yet. Take the register and complete it on the day.
              </p>
            )}

            {!completed && showCancel && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-base sm:h-9 sm:text-sm"
                  placeholder="Reason (required) — e.g. gym closed"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Button size="sm" variant="destructive" className="h-11 sm:h-9" onClick={handleCancel}>Confirm Cancel</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
