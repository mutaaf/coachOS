"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  MapPin,
  Users,
  Mail,
  Phone,
  GraduationCap,
  Calendar,
  FileText,
  Clock,
  CreditCard,
  Plus,
  Copy,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Link2,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SchoolFormDialog } from "@/components/school-form-dialog";
import { ProgramFormDialog } from "@/components/program-form-dialog";
import type { WebsiteListing } from "@/lib/queries/registrations";
import { ScheduleTemplateFormDialog } from "@/components/schedule-template-form-dialog";
import { AddStudentToSchoolDialog } from "@/components/add-student-to-school-dialog";
import { EnrollStudentDialog } from "@/components/enroll-student-dialog";
import { StudentFormDialog } from "@/components/student-form-dialog";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { LinkParentDialog } from "@/components/link-parent-dialog";
import { deleteScheduleTemplate } from "@/lib/actions/schedule";
import { archiveSchool } from "@/lib/actions/schools";
import { withdrawEnrollment } from "@/lib/actions/students";
import { waiveInvoice } from "@/lib/actions/payments";
import type { School, Program, ScheduleTemplate, Parent } from "@/types/database";
import type {
  SchoolStudent,
  SchoolScheduleTemplate,
  SchoolSession,
  SchoolInvoice,
} from "@/lib/queries/schools";
import { formatCurrency } from "@/lib/utils";

interface SchoolDetailClientProps {
  school: School;
  programs: Program[];
  students: SchoolStudent[];
  scheduleTemplates: SchoolScheduleTemplate[];
  upcomingSessions: SchoolSession[];
  invoices: SchoolInvoice[];
  allSchools: (School & { program_count: number; student_count: number })[];
  allParents: Parent[];
  websiteListings: WebsiteListing[];
}

function getStatusBadgeVariant(
  status: string
): "success" | "secondary" | "warning" | "destructive" {
  switch (status) {
    case "active":
      return "success";
    case "inactive":
    case "withdrawn":
      return "secondary";
    case "archived":
    case "cancelled":
      return "warning";
    case "completed":
      return "secondary";
    default:
      return "secondary";
  }
}

function getProgramStatusVariant(
  status: Program["status"]
): "success" | "secondary" | "warning" | "default" {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "default";
    case "completed":
      return "secondary";
    case "cancelled":
      return "warning";
    default:
      return "secondary";
  }
}

function getInvoiceStatusVariant(
  status: string
): "success" | "secondary" | "warning" | "destructive" | "default" {
  switch (status) {
    case "paid":
      return "success";
    case "pending":
      return "default";
    case "overdue":
      return "destructive";
    case "waived":
      return "secondary";
    default:
      return "secondary";
  }
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${minutes} ${ampm}`;
}

export function SchoolDetailClient({
  school,
  programs,
  students,
  scheduleTemplates,
  upcomingSessions,
  invoices,
  allSchools,
  allParents,
  websiteListings,
}: SchoolDetailClientProps) {
  const router = useRouter();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | undefined>();
  const [duplicatingProgram, setDuplicatingProgram] = useState<
    Partial<Program> | undefined
  >();
  const [studentDialogOpen, setStudentDialogOpen] = useState(false);
  const [enrollStudent, setEnrollStudent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingStudent, setEditingStudent] = useState<SchoolStudent | undefined>();
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | undefined>();
  const [linkingStudentId, setLinkingStudentId] = useState<string | null>(null);

  const uniqueStudentCount = new Set(students.map((s) => s.id)).size;

  // Payment summary calculations
  const pendingTotal = invoices
    .filter((i) => i.status === "pending")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueTotal = invoices
    .filter((i) => i.status === "overdue")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  // Group schedule templates by day
  const templatesByDay = new Map<number, SchoolScheduleTemplate[]>();
  for (const t of scheduleTemplates) {
    const existing = templatesByDay.get(t.day_of_week) || [];
    existing.push(t);
    templatesByDay.set(t.day_of_week, existing);
  }

  function handleEditProgram(program: Program) {
    setEditingProgram(program);
    setDuplicatingProgram(undefined);
    setProgramDialogOpen(true);
  }

  function handleDuplicateProgram(program: Program) {
    setEditingProgram(undefined);
    setDuplicatingProgram({
      name: program.name,
      season: program.season,
      start_date: program.start_date,
      end_date: program.end_date,
      monthly_fee: program.monthly_fee,
      notes: program.notes,
    });
    setProgramDialogOpen(true);
  }

  function handleAddProgram() {
    setEditingProgram(undefined);
    setDuplicatingProgram(undefined);
    setProgramDialogOpen(true);
  }

  function handleProgramDialogClose(open: boolean) {
    setProgramDialogOpen(open);
    if (!open) {
      setEditingProgram(undefined);
      setDuplicatingProgram(undefined);
    }
  }

  function handleStudentDialogClose(open: boolean) {
    setStudentDialogOpen(open);
    if (!open) {
      router.refresh();
    }
  }

  function handleEnrollDialogClose() {
    setEnrollStudent(null);
    router.refresh();
  }

  function handlePaymentDialogClose(open: boolean) {
    if (!open) {
      setPaymentInvoiceId(null);
      router.refresh();
    }
  }

  function handleTemplateDialogClose(open: boolean) {
    setTemplateDialogOpen(open);
    if (!open) {
      setEditingTemplate(undefined);
    }
  }

  function handleEditTemplate(template: SchoolScheduleTemplate) {
    setEditingTemplate({
      id: template.id,
      program_id: template.program_id,
      day_of_week: template.day_of_week,
      start_time: template.start_time,
      end_time: template.end_time,
      location: template.location,
      created_at: template.created_at,
    });
    setTemplateDialogOpen(true);
  }

  async function handleDeleteTemplate(id: string) {
    const result = await deleteScheduleTemplate(id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Schedule template deleted");
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button and header */}
      <div>
        <Link
          href="/schools"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Schools
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {school.name}
            </h1>
            <Badge variant={getStatusBadgeVariant(school.status)}>
              {school.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {school.status !== "archived" && (
              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={async () => {
                  if (!window.confirm("Archive this school? This cannot be easily undone.")) return;
                  const result = await archiveSchool(school.id);
                  if (result.error) toast.error(result.error);
                  else router.push("/schools");
                }}
              >
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            )}
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setEditDialogOpen(true)}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="students">
            Students ({uniqueStudentCount})
          </TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Contact Info */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Contact Information
              </h3>
              <div className="space-y-3">
                {school.contact_name && (
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm">{school.contact_name}</span>
                  </div>
                )}
                {school.contact_email && (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <a
                      href={`mailto:${school.contact_email}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {school.contact_email}
                    </a>
                  </div>
                )}
                {school.contact_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <a
                      href={`tel:${school.contact_phone}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {school.contact_phone}
                    </a>
                  </div>
                )}
                {!school.contact_name &&
                  !school.contact_email &&
                  !school.contact_phone && (
                    <p className="text-sm text-muted-foreground">
                      No contact information added
                    </p>
                  )}
              </div>
            </div>

            {/* Address */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Address
              </h3>
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <span className="text-sm">
                  {school.address || "No address added"}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Notes
              </h3>
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-sm whitespace-pre-wrap">
                  {school.notes || "No notes added"}
                </p>
              </div>
            </div>
          </div>

          {/* Programs List */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Programs</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {programs.length}{" "}
                  {programs.length === 1 ? "program" : "programs"}
                </span>
                <Button size="sm" onClick={handleAddProgram}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Program
                </Button>
              </div>
            </div>

            {programs.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
                <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  No programs created yet for this school
                </p>
                <Button size="sm" variant="outline" onClick={handleAddProgram}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create First Program
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {programs.map((program) => (
                  <div
                    key={program.id}
                    className="rounded-2xl border bg-white p-5 shadow-sm flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                        <GraduationCap className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium text-sm">{program.name}</h4>
                        <div className="flex items-center gap-3 mt-1">
                          {program.season && (
                            <span className="text-xs text-muted-foreground">
                              {program.season}
                            </span>
                          )}
                          {program.start_date && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(
                                program.start_date
                              ).toLocaleDateString()}
                              {program.end_date &&
                                ` - ${new Date(program.end_date).toLocaleDateString()}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {formatCurrency(program.monthly_fee)}/mo
                      </span>
                      <Badge variant={getProgramStatusVariant(program.status)}>
                        {program.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditProgram(program)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDuplicateProgram(program)}
                        title="Duplicate program"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Students Tab */}
        <TabsContent value="students" className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Students ({uniqueStudentCount})
            </h2>
            <Button size="sm" onClick={() => setStudentDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Student
            </Button>
          </div>

          {students.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No students enrolled at this school yet
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStudentDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add First Student
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                      Name
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                      Grade
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                      Parent
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                      Program
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                      Status
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-6 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr
                      key={student.enrollment_id}
                      className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium">
                          {student.first_name} {student.last_name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-muted-foreground">
                          {student.grade || "-"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-muted-foreground">
                          {student.parent_name || "-"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-muted-foreground">
                          {student.program_name || "-"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant={getStatusBadgeVariant(
                            student.enrollment_status
                          )}
                        >
                          {student.enrollment_status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingStudent(student)}
                          title="Edit student"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLinkingStudentId(student.id)}
                          title="Link parents"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEnrollStudent({
                              id: student.id,
                              name: `${student.first_name} ${student.last_name}`,
                            })
                          }
                        >
                          Enroll
                        </Button>
                        {student.enrollment_status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={async () => {
                              if (!window.confirm(`Withdraw ${student.first_name} ${student.last_name} from ${student.program_name}?`)) return;
                              const result = await withdrawEnrollment(student.enrollment_id);
                              if (result.error) toast.error(result.error);
                              else { toast.success("Enrollment withdrawn"); router.refresh(); }
                            }}
                          >
                            Withdraw
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-6 space-y-6">
          {scheduleTemplates.length === 0 && upcomingSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">No schedule yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Add schedule templates to your programs to see the weekly
                schedule here.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingTemplate(undefined);
                  setTemplateDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add First Schedule
              </Button>
            </div>
          ) : (
            <>
              {/* Weekly Schedule */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Weekly Schedule</h2>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingTemplate(undefined);
                      setTemplateDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Schedule
                  </Button>
                </div>
                {scheduleTemplates.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {DAY_NAMES.map((dayName, dayIndex) => {
                      const dayTemplates = templatesByDay.get(dayIndex);
                      if (!dayTemplates) return null;
                      return (
                        <div
                          key={dayIndex}
                          className="rounded-2xl border bg-white p-5 shadow-sm"
                        >
                          <h3 className="text-sm font-semibold mb-3">
                            {dayName}
                          </h3>
                          <div className="space-y-2">
                            {dayTemplates.map((t) => (
                              <div
                                key={t.id}
                                className="group flex items-center gap-2 text-sm"
                              >
                                <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="font-medium">
                                  {t.program_name}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatTime(t.start_time)} -{" "}
                                  {formatTime(t.end_time)}
                                </span>
                                <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => handleEditTemplate(t)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteTemplate(t.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No templates yet. Click &quot;Add Schedule&quot; to create one.
                  </p>
                )}
              </div>

              {/* Upcoming Sessions */}
              {upcomingSessions.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold mb-4">
                    Upcoming Sessions
                  </h2>
                  <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                            Date
                          </th>
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                            Program
                          </th>
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3 hidden sm:table-cell">
                            Time
                          </th>
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingSessions.map((session) => (
                          <tr
                            key={session.id}
                            className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <span className="text-sm font-medium">
                                {new Date(session.date).toLocaleDateString(
                                  "en-US",
                                  {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  }
                                )}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm">
                                {session.program_name}
                              </span>
                            </td>
                            <td className="px-6 py-4 hidden sm:table-cell">
                              <span className="text-sm text-muted-foreground">
                                {formatTime(session.start_time)} -{" "}
                                {formatTime(session.end_time)}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <Badge
                                variant={getStatusBadgeVariant(session.status)}
                              >
                                {session.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="mt-6 space-y-6">
          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Invoices for this school&apos;s programs will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Summary Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100">
                      <DollarSign className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Pending</p>
                      <p className="text-lg font-semibold">
                        {formatCurrency(pendingTotal)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Overdue</p>
                      <p className="text-lg font-semibold">
                        {formatCurrency(overdueTotal)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Paid</p>
                      <p className="text-lg font-semibold">
                        {formatCurrency(paidTotal)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Invoice Table */}
              <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Student
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Program
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Month
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Amount
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Status
                      </th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-6 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr
                        key={invoice.id}
                        className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium">
                            {invoice.student_name}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-muted-foreground">
                            {invoice.program_name}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-muted-foreground">
                            {invoice.month}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium">
                            {formatCurrency(invoice.amount)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant={getInvoiceStatusVariant(invoice.status)}
                          >
                            {invoice.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {(invoice.status === "pending" ||
                            invoice.status === "overdue") && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPaymentInvoiceId(invoice.id)}
                              >
                                Record Payment
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={async () => {
                                  if (!window.confirm("Waive this invoice?")) return;
                                  await waiveInvoice(invoice.id);
                                  toast.success("Invoice waived");
                                  router.refresh();
                                }}
                              >
                                Waive
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <SchoolFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        school={school}
      />

      <ProgramFormDialog
        open={programDialogOpen}
        onOpenChange={handleProgramDialogClose}
        schools={allSchools}
        schoolId={editingProgram || !duplicatingProgram ? school.id : undefined}
        program={editingProgram}
        defaultValues={duplicatingProgram}
        websiteListings={websiteListings}
      />

      <AddStudentToSchoolDialog
        open={studentDialogOpen}
        onOpenChange={handleStudentDialogClose}
        schoolId={school.id}
        schoolName={school.name}
        programs={programs}
      />

      <StudentFormDialog
        open={!!editingStudent}
        onOpenChange={(open) => {
          if (!open) {
            setEditingStudent(undefined);
            router.refresh();
          }
        }}
        student={editingStudent}
      />

      {enrollStudent && (
        <EnrollStudentDialog
          open={!!enrollStudent}
          onOpenChange={handleEnrollDialogClose}
          studentId={enrollStudent.id}
          studentName={enrollStudent.name}
          programs={programs.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            school_id: p.school_id,
            school: { name: school.name },
          }))}
          studentEnrolledProgramIds={
            students
              .filter((s) => s.id === enrollStudent.id)
              .map((s) => s.program_id)
          }
          schoolId={school.id}
        />
      )}

      <RecordPaymentDialog
        open={!!paymentInvoiceId}
        onOpenChange={handlePaymentDialogClose}
        invoiceId={paymentInvoiceId}
      />

      {linkingStudentId && (() => {
        const student = students.find((s) => s.id === linkingStudentId);
        if (!student) return null;
        const linkedParents = student.parent_links.map((link) => {
          const parent = allParents.find((p) => p.id === link.parent_id);
          return parent ? { ...parent, relationship: link.relationship } : null;
        }).filter(Boolean) as (Parent & { relationship: string })[];
        return (
          <LinkParentDialog
            open={!!linkingStudentId}
            onOpenChange={(open) => { if (!open) setLinkingStudentId(null); }}
            studentId={student.id}
            studentName={`${student.first_name} ${student.last_name}`}
            linkedParents={linkedParents}
            allParents={allParents}
          />
        );
      })()}

      <ScheduleTemplateFormDialog
        open={templateDialogOpen}
        onOpenChange={handleTemplateDialogClose}
        programs={programs.map((p) => ({ id: p.id, name: p.name }))}
        template={editingTemplate}
      />
    </div>
  );
}
