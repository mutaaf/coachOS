"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { AttendanceDialog } from "@/components/attendance-dialog";
import { ScheduleTemplateFormDialog } from "@/components/schedule-template-form-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateSessions, deleteScheduleTemplate, fetchScheduleTemplates, fetchSessionsForWeek } from "@/lib/actions/schedule";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Users,
  Plus,
  RefreshCw,
  Settings2,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ScheduleTemplate } from "@/types/database";
import { businessToday, businessWeek, dayOfWeek, formatDateOnly } from "@/lib/dates";

const SCHOOL_COLORS = ["#007AFF", "#34C759", "#FF9500", "#FF3B30", "#5856D6", "#FF2D55", "#AF52DE", "#00C7BE"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface SchedulePageClientProps {
  initialSessions: any[];
  programs: any[];
  coaches?: { id: string; first_name: string; last_name: string; cleared?: boolean; clearance?: import("@/lib/coach-clearance").CoachClearance }[];
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${minutes} ${ampm}`;
}

export function SchedulePageClient({ initialSessions, programs, coaches = [] }: SchedulePageClientProps) {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filterProgram, setFilterProgram] = useState("");

  // Manage Templates state
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | undefined>();

  // Days as YYYY-MM-DD from Dallas's date, so neither the browser's timezone
  // nor 7pm in Dallas (midnight UTC) slides practices into the wrong column.
  const today = businessToday();
  const weekDates = businessWeek(weekOffset);
  const schoolColorMap = new Map<string, string>();
  programs.forEach((p: any, i: number) => {
    if (p.school && !schoolColorMap.has(p.school.id)) {
      schoolColorMap.set(p.school.id, SCHOOL_COLORS[schoolColorMap.size % SCHOOL_COLORS.length]);
    }
  });

  useEffect(() => {
    fetchSessionsForWeek(weekDates[0], weekDates[6]).then((data) => {
      if (data) setSessions(data);
    });
  }, [weekOffset]);

  const filteredSessions = filterProgram
    ? sessions.filter((s: any) => s.program_id === filterProgram)
    : sessions;

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await generateSessions(null, 4);
      toast.success(`${result.data?.sessionsCreated || 0} practice(s) added`);
      setWeekOffset((w) => w); // trigger refetch
    } catch {
      toast.error("Failed to add practices");
    } finally {
      setGenerating(false);
    }
  }

  async function fetchTemplates() {
    setLoadingTemplates(true);
    const data = await fetchScheduleTemplates();
    setTemplates(data || []);
    setLoadingTemplates(false);
  }

  function handleOpenManageTemplates() {
    setManageTemplatesOpen(true);
    fetchTemplates();
  }

  function handleEditTemplate(t: any) {
    setEditingTemplate({
      id: t.id,
      program_id: t.program_id,
      day_of_week: t.day_of_week,
      start_time: t.start_time,
      end_time: t.end_time,
      location: t.location,
      // Left out, the form opened on "Not assigned" and saving cleared the coach.
      coach_id: t.coach_id,
      created_at: t.created_at,
    });
    setTemplateFormOpen(true);
  }

  async function handleDeleteTemplate(id: string) {
    const result = await deleteScheduleTemplate(id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Template deleted");
      fetchTemplates();
    }
  }

  function handleTemplateFormClose(open: boolean) {
    setTemplateFormOpen(open);
    if (!open) {
      setEditingTemplate(undefined);
      fetchTemplates();
      router.refresh();
    }
  }

  const weekLabel = `${formatDateOnly(weekDates[0], { month: "short", day: "numeric" })} — ${formatDateOnly(weekDates[6], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div>
      {/* Page Header — title, one line of context, then actions (full width on phones) */}
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This week&apos;s practices. Open one to take the register.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:shrink-0">
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="h-11 w-full sm:order-last sm:h-10 sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Adding..." : "Add practices"}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenManageTemplates}
            className="h-11 w-full sm:h-10 sm:w-auto"
          >
            <Settings2 className="h-4 w-4 mr-2" />
            Manage Templates
          </Button>
        </div>
      </div>

      {/* Week navigation and filter */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
            onClick={() => setWeekOffset((w) => w - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 shrink-0 px-4 sm:h-9"
            onClick={() => setWeekOffset(0)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
            onClick={() => setWeekOffset((w) => w + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-auto min-w-0 text-right text-sm font-medium tabular-nums sm:ml-2 sm:text-left">
            {weekLabel}
          </span>
        </div>
        <Select
          aria-label="Show practices for"
          options={[
            { value: "", label: "All sessions" },
            ...programs.map((p: any) => ({ value: p.id, label: `${p.school?.name} — ${p.name}` })),
          ]}
          value={filterProgram}
          onChange={(e) => setFilterProgram(e.target.value)}
          className="h-11 w-full text-base sm:h-10 sm:w-64 sm:text-sm"
        />
      </div>

      {/* The week. On phones each day is a row (date on the left, its
          practices beside it); from md up it is the familiar 7-column grid.
          One set of elements serves both, so data-testids stay unique. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {weekDates.map((dateStr) => {
          const daySessions = filteredSessions.filter((s: any) => s.date === dateStr);
          const isToday = dateStr === today;

          return (
            <div
              key={dateStr}
              className={`flex gap-3 border-b pb-2 last:border-b-0 md:block md:min-h-[200px] md:border-b-0 md:pb-0 ${
                daySessions.length === 0 ? "items-center" : "items-start"
              }`}
              data-testid="schedule-day"
              data-date={dateStr}
              aria-current={isToday ? "date" : undefined}
            >
              <div
                className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 text-center md:mb-2 md:w-auto md:py-2 ${
                  isToday ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <div className="text-xs font-medium">{DAY_NAMES[dayOfWeek(dateStr)]}</div>
                <div className="text-lg font-bold tabular-nums leading-tight md:leading-normal">
                  {Number(dateStr.slice(8))}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {daySessions.length === 0 && (
                  <p className="text-sm text-muted-foreground md:hidden">No practices</p>
                )}
                {daySessions.map((session: any) => {
                  const program = session.program;
                  const school = program?.school;
                  const color = school ? schoolColorMap.get(school.id) || "#007AFF" : "#007AFF";
                  const isCancelled = session.status === "cancelled";
                  const isCompleted = session.status === "completed";

                  return (
                    <button
                      key={session.id}
                      className={`flex min-h-[56px] w-full items-center gap-2 rounded-xl border p-3 text-left transition-shadow hover:shadow-md active:bg-muted/60 md:block md:min-h-0 md:p-2 ${
                        isCancelled ? "opacity-50 bg-muted" : "bg-card"
                      }`}
                      style={{ borderLeftWidth: "3px", borderLeftColor: color }}
                      onClick={() => { setSelectedSession(session); setShowAttendance(true); }}
                    >
                      <span className="block min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium md:whitespace-normal md:text-xs ${
                            isCancelled ? "line-through" : ""
                          }`}
                        >
                          {program?.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span className="whitespace-nowrap tabular-nums">
                            {session.start_time ? formatTime(session.start_time) : ""}
                            {session.end_time && (
                              <span className="md:hidden"> – {formatTime(session.end_time)}</span>
                            )}
                          </span>
                          {school && (
                            <span className="truncate md:hidden">&middot; {school.name}</span>
                          )}
                        </span>
                        {school && (
                          <span className="mt-0.5 hidden truncate text-xs text-muted-foreground md:block">
                            {school.name}
                          </span>
                        )}
                      </span>
                      {isCancelled && (
                        <Badge variant="secondary" className="shrink-0 text-xs md:mt-1">Cancelled</Badge>
                      )}
                      {isCompleted && (
                        <Badge variant="success" className="shrink-0 text-xs md:hidden">Done</Badge>
                      )}
                      {!isCancelled && !isCompleted && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {filteredSessions.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          No practices this week. Set the weekly times in Manage Templates, then tap Add practices.
        </p>
      )}

      {selectedSession && (
        <AttendanceDialog
          open={showAttendance}
          onOpenChange={(open) => { setShowAttendance(open); if (!open) setSelectedSession(null); }}
          session={selectedSession}
          coaches={coaches}
          onCoachChange={(coachId) => {
            const updated = { ...selectedSession, coach_id: coachId };
            setSelectedSession(updated);
            setSessions((all) => all.map((s: any) => (s.id === updated.id ? updated : s)));
          }}
        />
      )}

      {/* Manage Templates Dialog */}
      <Dialog open={manageTemplatesOpen} onOpenChange={setManageTemplatesOpen}>
        <DialogContent onClose={() => setManageTemplatesOpen(false)} className="max-w-lg">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>Manage Schedule Templates</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3 sm:max-h-[60vh] sm:overflow-y-auto">
            {loadingTemplates ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No schedule templates yet. Add the weekly time each session meets, then use
                Add practices to put them on the calendar.
              </p>
            ) : (
              templates.map((t: any) => (
                <div
                  key={t.id}
                  className="group flex items-center justify-between gap-2 rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-words sm:truncate">
                      {t.program?.name}
                      {t.program?.school?.name && (
                        <span className="block text-muted-foreground font-normal sm:inline">
                          <span className="hidden sm:inline"> — </span>
                          {t.program.school.name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      {FULL_DAY_NAMES[t.day_of_week]} &middot;{" "}
                      <span className="whitespace-nowrap">
                        {formatTime(t.start_time)} – {formatTime(t.end_time)}
                      </span>
                      {t.location && ` · ${t.location}`}
                    </div>
                  </div>
                  {/* Always shown on touch screens — there is no hover to reveal them. */}
                  <div className="flex shrink-0 items-center gap-2 transition-opacity md:gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0 md:h-8 md:w-8"
                      aria-label="Edit template"
                      onClick={() => handleEditTemplate(t)}
                    >
                      <Pencil className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0 text-destructive hover:text-destructive md:h-8 md:w-8"
                      aria-label="Delete template"
                      onClick={() => handleDeleteTemplate(t.id)}
                    >
                      <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full sm:h-9"
              onClick={() => {
                setEditingTemplate(undefined);
                setTemplateFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Form Dialog */}
      <ScheduleTemplateFormDialog
        coaches={coaches}
        open={templateFormOpen}
        onOpenChange={handleTemplateFormClose}
        programs={programs.map((p: any) => ({ id: p.id, name: `${p.school?.name} — ${p.name}` }))}
        template={editingTemplate}
      />
    </div>
  );
}
