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
  Upload,
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
import { RosterImportDialog } from "@/components/roster-import-dialog";
import { deleteScheduleTemplate } from "@/lib/actions/schedule";
import { ArchiveSchoolDialog } from "@/components/archive-school-dialog";
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
import { formatDateOnly } from "@/lib/dates";

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
  defaultMonthlyFee: string;
  catalog?: { id: string; name: string; description: string; default_monthly_fee: number; default_capacity: number }[];
  seasons?: { id: string; name: string; status: string }[];
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026", for the phone cards; anything else is shown as is. */
function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

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
  defaultMonthlyFee,
  catalog = [],
  seasons = [],
}: SchoolDetailClientProps) {
  const router = useRouter();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // undefined = closed; null = open for a new session at this school.
  const [rosterProgramId, setRosterProgramId] = useState<string | null | undefined>();
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

  const [archiveOpen, setArchiveOpen] = useState(false);

  const uniqueStudentCount = new Set(students.map((s) => s.id)).size;
  const activeStudentCount = new Set(
    students.filter((s) => s.enrollment_status === "active").map((s) => s.id)
  ).size;

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

  async function handleWithdraw(student: SchoolStudent) {
    if (!window.confirm(`Withdraw ${student.first_name} ${student.last_name} from ${student.program_name}?`)) return;
    const result = await withdrawEnrollment(student.enrollment_id);
    if (result.error) toast.error(result.error);
    else { toast.success("Enrollment withdrawn"); router.refresh(); }
  }

  async function handleWaive(invoiceId: string) {
    if (!window.confirm("Waive this invoice?")) return;
    await waiveInvoice(invoiceId);
    toast.success("Invoice waived");
    router.refresh();
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
          className="-ml-1 mb-2 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Schools
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 break-words text-2xl font-bold">
                {school.name}
              </h1>
              <Badge variant={getStatusBadgeVariant(school.status)} className="shrink-0">
                {school.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {activeStudentCount} {activeStudentCount === 1 ? "child" : "children"} enrolled ·{" "}
              {programs.length} {programs.length === 1 ? "session" : "sessions"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
            {school.status !== "archived" && (
              <Button
                variant="outline"
                className="h-11 gap-2 text-destructive hover:text-destructive sm:h-10"
                onClick={() => setArchiveOpen(true)}
              >
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            )}
            <Button
              variant="outline"
              className={`h-11 gap-2 sm:h-10 ${school.status === "archived" ? "col-span-2" : ""}`}
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
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-12 w-max sm:h-10">
            <TabsTrigger value="overview" className="h-10 px-4 sm:h-8 sm:px-3">Overview</TabsTrigger>
            <TabsTrigger value="students" className="h-10 px-4 sm:h-8 sm:px-3">
              Students ({uniqueStudentCount})
            </TabsTrigger>
            <TabsTrigger value="schedule" className="h-10 px-4 sm:h-8 sm:px-3">Schedule</TabsTrigger>
            <TabsTrigger value="payments" className="h-10 px-4 sm:h-8 sm:px-3">Payments</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-4 sm:mt-6">
          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Contact Info */}
            <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3 sm:mb-4">
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
                      className="min-w-0 break-all py-1 text-sm text-primary hover:underline"
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
                      className="py-1 text-sm text-primary hover:underline tabular-nums"
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
            <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3 sm:mb-4">
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
            <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3 sm:mb-4">
                Notes
              </h3>
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="min-w-0 break-words text-sm whitespace-pre-wrap">
                  {school.notes || "No notes added"}
                </p>
              </div>
            </div>
          </div>

          {/* Programs List */}
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold">Sessions</h2>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {programs.length}{" "}
                  {programs.length === 1 ? "session" : "sessions"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <Button variant="outline" className="h-11 sm:h-9" onClick={() => setRosterProgramId(null)}>
                  <Upload className="h-4 w-4 mr-1" />
                  Import roster
                </Button>
                <Button className="h-11 sm:h-9" onClick={handleAddProgram}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add session
                </Button>
              </div>
            </div>

            {programs.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-8">
                <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  No sessions at this school yet
                </p>
                <Button variant="outline" className="h-11 sm:h-9" onClick={handleAddProgram}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add first session
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {programs.map((program) => (
                  <div
                    key={program.id}
                    className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"
                  >
                    <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                        <GraduationCap className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="min-w-0 break-words font-medium text-sm">{program.name}</h4>
                          <Badge variant={getProgramStatusVariant(program.status)} className="shrink-0 sm:hidden">
                            {program.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                          {program.season && (
                            <span className="text-xs text-muted-foreground">
                              {program.season}
                            </span>
                          )}
                          {program.start_date && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1 tabular-nums">
                              <Calendar className="h-3 w-3 shrink-0" />
                              {formatDateOnly(program.start_date)}
                              {program.end_date &&
                                ` - ${formatDateOnly(program.end_date)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t pt-2 sm:justify-end sm:gap-3 sm:border-0 sm:pt-0">
                      <span className="whitespace-nowrap text-sm font-medium tabular-nums">
                        {Number(program.monthly_fee) > 0
                          ? `${formatCurrency(program.monthly_fee)}/mo`
                          : "Free – no invoices"}
                      </span>
                      <Badge variant={getProgramStatusVariant(program.status)} className="hidden sm:inline-flex">
                        {program.status}
                      </Badge>
                      <div className="flex items-center gap-2 sm:gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 p-0 sm:h-9 sm:w-auto sm:px-3"
                          onClick={() => setRosterProgramId(program.id)}
                          title="Import this session's roster"
                        >
                          <Upload className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          <span className="sr-only">Import roster</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 p-0 sm:h-9 sm:w-auto sm:px-3"
                          aria-label={`Edit ${program.name}`}
                          title="Edit session"
                          onClick={() => handleEditProgram(program)}
                        >
                          <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 p-0 sm:h-9 sm:w-auto sm:px-3"
                          aria-label={`Duplicate ${program.name}`}
                          onClick={() => handleDuplicateProgram(program)}
                          title="Duplicate session"
                        >
                          <Copy className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Students Tab */}
        <TabsContent value="students" className="mt-4 sm:mt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold">
              Students ({uniqueStudentCount})
            </h2>
            <Button className="h-11 sm:h-9" onClick={() => setStudentDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Student
            </Button>
          </div>

          {students.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-8">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No students enrolled at this school yet
              </p>
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => setStudentDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add First Student
              </Button>
            </div>
          ) : (
            <>
            {/* Phones: one card per enrollment */}
            <ul className="space-y-3 md:hidden" aria-label="Students">
              {students.map((student) => (
                <li
                  key={student.enrollment_id}
                  className="rounded-2xl border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {student.first_name} {student.last_name}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {[
                          student.grade ? `Grade ${student.grade}` : null,
                          student.parent_name,
                          student.program_name,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No details yet"}
                      </p>
                    </div>
                    <Badge
                      variant={getStatusBadgeVariant(student.enrollment_status)}
                      className="shrink-0"
                    >
                      {student.enrollment_status}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="h-11 gap-1.5"
                      onClick={() => setEditingStudent(student)}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 gap-1.5"
                      onClick={() => setLinkingStudentId(student.id)}
                    >
                      <Link2 className="h-4 w-4" />
                      Link parents
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11"
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
                        variant="outline"
                        className="h-11 text-destructive hover:text-destructive"
                        onClick={() => handleWithdraw(student)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-2xl border bg-white shadow-sm overflow-x-auto md:block">
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
                      Session
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
                          aria-label={`Edit ${student.first_name} ${student.last_name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLinkingStudentId(student.id)}
                          title="Link parents"
                          aria-label={`Link parents of ${student.first_name} ${student.last_name}`}
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
                            onClick={() => handleWithdraw(student)}
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
            </>
          )}
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-4 space-y-6 sm:mt-6">
          {scheduleTemplates.length === 0 && upcomingSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">No schedule yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Add a weekly practice time to your sessions to see the weekly
                schedule here.
              </p>
              <Button
                variant="outline"
                className="h-11 sm:h-9"
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
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold">Weekly Schedule</h2>
                  <Button
                    className="h-11 sm:h-9"
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
                          className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5"
                        >
                          <h3 className="text-sm font-semibold mb-2 sm:mb-3">
                            {dayName}
                          </h3>
                          <div className="space-y-1 md:space-y-2">
                            {dayTemplates.map((t) => (
                              <div
                                key={t.id}
                                className="group flex items-center gap-2 text-sm"
                              >
                                <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="flex min-w-0 flex-1 flex-col md:flex-row md:flex-wrap md:items-center md:gap-x-2">
                                  <span className="break-words font-medium">
                                    {t.program_name}
                                  </span>
                                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                                    {formatTime(t.start_time)} -{" "}
                                    {formatTime(t.end_time)}
                                  </span>
                                </span>
                                <span className="ml-auto flex shrink-0 items-center gap-2 transition-opacity md:gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-11 w-11 p-0 md:h-6 md:w-6"
                                    aria-label={`Edit ${t.program_name}, ${dayName} ${formatTime(t.start_time)}`}
                                    onClick={() => handleEditTemplate(t)}
                                  >
                                    <Pencil className="h-4 w-4 md:h-3 md:w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-11 w-11 p-0 text-destructive hover:text-destructive md:h-6 md:w-6"
                                    aria-label={`Delete ${t.program_name}, ${dayName} ${formatTime(t.start_time)}`}
                                    onClick={() => handleDeleteTemplate(t.id)}
                                  >
                                    <Trash2 className="h-4 w-4 md:h-3 md:w-3" />
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
                    Upcoming practices
                  </h2>
                  {/* Phones: a calendar-tile list. The date is split across two
                      lines here, so it never doubles the table's text. */}
                  <ul className="divide-y rounded-2xl border bg-white shadow-sm md:hidden" aria-label="Upcoming practices">
                    {upcomingSessions.map((session) => (
                      <li key={session.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-muted/60 py-1.5 leading-tight">
                          <span className="text-xs font-medium uppercase text-muted-foreground">
                            {formatDateOnly(session.date, { weekday: "short" })}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">
                            {formatDateOnly(session.date, { month: "short" })}{" "}
                            {formatDateOnly(session.date, { day: "numeric" })}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium">{session.program_name}</p>
                          <p className="text-sm text-muted-foreground tabular-nums">
                            {formatTime(session.start_time)} – {formatTime(session.end_time)}
                          </p>
                        </div>
                        <Badge variant={getStatusBadgeVariant(session.status)} className="shrink-0">
                          {session.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden rounded-2xl border bg-white shadow-sm overflow-x-auto md:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                            Date
                          </th>
                          <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                            Session
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
                                {formatDateOnly(session.date, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })}
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
        <TabsContent value="payments" className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
              <CreditCard className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Invoices for this school&apos;s sessions will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Summary Row */}
              <div className="grid grid-cols-3 gap-2 md:gap-4">
                {[
                  { label: "Pending", total: pendingTotal, Icon: DollarSign, tint: "bg-yellow-100", ink: "text-yellow-600" },
                  { label: "Overdue", total: overdueTotal, Icon: AlertCircle, tint: "bg-red-100", ink: "text-red-600" },
                  { label: "Paid", total: paidTotal, Icon: CheckCircle2, tint: "bg-green-100", ink: "text-green-600" },
                ].map(({ label, total, Icon, tint, ink }) => (
                  <div key={label} className="min-w-0 rounded-2xl border bg-white p-3 shadow-sm md:p-5">
                    <div className="flex items-center gap-3">
                      <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl md:flex ${tint}`}>
                        <Icon className={`h-5 w-5 ${ink}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 text-xs text-muted-foreground md:text-sm">
                          <Icon className={`h-3.5 w-3.5 shrink-0 md:hidden ${ink}`} />
                          {label}
                        </p>
                        <p className="whitespace-nowrap text-base font-semibold tabular-nums md:text-lg">
                          {formatCurrency(total)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Phones: one card per invoice */}
              <ul className="space-y-3 md:hidden" aria-label="Invoices">
                {invoices.map((invoice) => {
                  const open = invoice.status === "pending" || invoice.status === "overdue";
                  return (
                    <li key={invoice.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-medium">{invoice.student_name}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {[invoice.program_name, formatMonth(invoice.month)].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="whitespace-nowrap font-semibold tabular-nums">
                            {formatCurrency(invoice.amount)}
                          </span>
                          <Badge variant={getInvoiceStatusVariant(invoice.status)}>{invoice.status}</Badge>
                        </div>
                      </div>
                      {open && (
                        <div className="mt-3 flex gap-2">
                          <Button className="h-11 flex-1" onClick={() => setPaymentInvoiceId(invoice.id)}>
                            Record Payment
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 flex-1 text-muted-foreground"
                            onClick={() => handleWaive(invoice.id)}
                          >
                            Waive
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Invoice Table */}
              <div className="hidden rounded-2xl border bg-white shadow-sm overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Student
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-6 py-3">
                        Session
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
                          <span className="whitespace-nowrap text-sm font-medium tabular-nums">
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
                                onClick={() => handleWaive(invoice.id)}
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

      <ArchiveSchoolDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        schoolId={school.id}
        schoolName={school.name}
        activeStudents={activeStudentCount}
      />

      <ProgramFormDialog
        open={programDialogOpen}
        onOpenChange={handleProgramDialogClose}
        schools={allSchools}
        schoolId={editingProgram || !duplicatingProgram ? school.id : undefined}
        program={editingProgram}
        defaultValues={duplicatingProgram}
        websiteListings={websiteListings}
        defaultMonthlyFee={defaultMonthlyFee}
        catalog={catalog}
        seasons={seasons}
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
      <RosterImportDialog
        open={rosterProgramId !== undefined}
        onOpenChange={(open) => !open && setRosterProgramId(undefined)}
        schools={[
          {
            id: school.id,
            name: school.name,
            programs: programs
              .filter((p) => p.status !== "cancelled" && p.status !== "completed")
              .map((p) => ({ id: p.id, name: p.name, monthly_fee: Number(p.monthly_fee) })),
          },
        ]}
        initialSchoolId={school.id}
        initialProgramId={rosterProgramId ?? undefined}
        defaultMonthlyFee={defaultMonthlyFee}
      />
    </div>
  );
}
