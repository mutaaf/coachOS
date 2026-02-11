"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { AttendanceDialog } from "@/components/attendance-dialog";
import { createClient } from "@/lib/supabase/client";
import { generateSessions, cancelSession, completeSession } from "@/lib/actions/schedule";
import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Users, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const SCHOOL_COLORS = ["#007AFF", "#34C759", "#FF9500", "#FF3B30", "#5856D6", "#FF2D55", "#AF52DE", "#00C7BE"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface SchedulePageClientProps {
  initialSessions: any[];
  programs: any[];
}

function getWeekDates(offset: number): Date[] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function isToday(d: Date): boolean {
  const now = new Date();
  return formatDate(d) === formatDate(now);
}

export function SchedulePageClient({ initialSessions, programs }: SchedulePageClientProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filterProgram, setFilterProgram] = useState("");

  const weekDates = getWeekDates(weekOffset);
  const schoolColorMap = new Map<string, string>();
  programs.forEach((p: any, i: number) => {
    if (p.schools && !schoolColorMap.has(p.schools.id)) {
      schoolColorMap.set(p.schools.id, SCHOOL_COLORS[schoolColorMap.size % SCHOOL_COLORS.length]);
    }
  });

  useEffect(() => {
    const supabase = createClient();
    const start = formatDate(weekDates[0]);
    const end = formatDate(weekDates[6]);
    supabase
      .from("sessions")
      .select("*, programs(*, schools(*))")
      .gte("date", start)
      .lte("date", end)
      .order("start_time")
      .then(({ data }) => {
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

  const weekLabel = `${weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <Button onClick={handleGenerate} disabled={generating} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating..." : "Generate Sessions"}
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2">{weekLabel}</span>
        </div>
        <Select
          options={[
            { value: "", label: "All Programs" },
            ...programs.map((p: any) => ({ value: p.id, label: `${p.schools?.name} — ${p.name}` })),
          ]}
          value={filterProgram}
          onChange={(e) => setFilterProgram(e.target.value)}
          className="w-64"
        />
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-7 gap-2">
        {weekDates.map((date, i) => {
          const dateStr = formatDate(date);
          const daySessions = filteredSessions.filter((s: any) => s.date === dateStr);

          return (
            <div key={i} className="min-h-[200px]">
              <div className={`text-center py-2 rounded-xl mb-2 ${isToday(date) ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <div className="text-xs font-medium">{DAY_NAMES[date.getDay()]}</div>
                <div className="text-lg font-bold">{date.getDate()}</div>
              </div>
              <div className="space-y-2">
                {daySessions.map((session: any) => {
                  const program = session.programs;
                  const school = program?.schools;
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

      {selectedSession && (
        <AttendanceDialog
          open={showAttendance}
          onOpenChange={(open) => { setShowAttendance(open); if (!open) setSelectedSession(null); }}
          session={selectedSession}
        />
      )}
    </div>
  );
}
