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
  coaches?: { id: string; first_name: string; last_name: string }[];
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
      toast.success(`${result.data?.sessionsCreated || 0} session(s) generated`);
      setWeekOffset((w) => w); // trigger refetch
    } catch {
      toast.error("Failed to generate sessions");
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
      {/* Page Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleOpenManageTemplates}>
            <Settings2 className="h-4 w-4 mr-2" />
            Manage Templates
          </Button>
          <Button onClick={handleGenerate} disabled={generating} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating..." : "Generate Sessions"}
          </Button>
        </div>
      </div>

      {/* Navigation — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>Today</Button>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2">{weekLabel}</span>
        </div>
        <Select
          options={[
            { value: "", label: "All Programs" },
            ...programs.map((p: any) => ({ value: p.id, label: `${p.school?.name} — ${p.name}` })),
          ]}
          value={filterProgram}
          onChange={(e) => setFilterProgram(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      {/* Week Grid — scrollable on mobile */}
      <div className="overflow-x-auto -mx-4 px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid grid-cols-7 gap-2" style={{ minWidth: "700px" }}>
          {weekDates.map((dateStr) => {
            const daySessions = filteredSessions.filter((s: any) => s.date === dateStr);
            const isToday = dateStr === today;

            return (
              <div
                key={dateStr}
                className="min-h-[200px]"
                data-testid="schedule-day"
                data-date={dateStr}
                aria-current={isToday ? "date" : undefined}
              >
                <div className={`text-center py-2 rounded-xl mb-2 ${isToday ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <div className="text-xs font-medium">{DAY_NAMES[dayOfWeek(dateStr)]}</div>
                  <div className="text-lg font-bold">{Number(dateStr.slice(8))}</div>
                </div>
                <div className="space-y-2">
                  {daySessions.map((session: any) => {
                    const program = session.program;
                    const school = program?.school;
                    const color = school ? schoolColorMap.get(school.id) || "#007AFF" : "#007AFF";
                    const isCancelled = session.status === "cancelled";

                    return (
                      <button
                        key={session.id}
                        className={`w-full text-left p-2 rounded-xl border transition-shadow hover:shadow-md ${
                          isCancelled ? "opacity-50 bg-muted" : "bg-card"
                        }`}
                        style={{ borderLeftWidth: "3px", borderLeftColor: color }}
                        onClick={() => { setSelectedSession(session); setShowAttendance(true); }}
                      >
                        <div className={`text-xs font-medium ${isCancelled ? "line-through" : ""}`}>
                          {program?.name}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {session.start_time?.slice(0, 5)}
                        </div>
                        {school && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {school.name}
                          </div>
                        )}
                        {isCancelled && (
                          <Badge variant="secondary" className="mt-1 text-xs">Cancelled</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
          <DialogHeader>
            <DialogTitle>Manage Schedule Templates</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {loadingTemplates ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No schedule templates yet.
              </p>
            ) : (
              templates.map((t: any) => (
                <div
                  key={t.id}
                  className="group flex items-center justify-between rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {t.program?.name}
                      {t.program?.school?.name && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          — {t.program.school.name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {FULL_DAY_NAMES[t.day_of_week]} &middot; {formatTime(t.start_time)} – {formatTime(t.end_time)}
                      {t.location && ` &middot; ${t.location}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label="Edit template"
                      onClick={() => handleEditTemplate(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      aria-label="Delete template"
                      onClick={() => handleDeleteTemplate(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
              className="w-full"
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
