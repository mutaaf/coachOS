"use client";

import { useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SchoolFormDialog } from "@/components/school-form-dialog";
import type { School, Program } from "@/types/database";
import type { SchoolStudent } from "@/lib/queries/schools";
import { formatCurrency } from "@/lib/utils";

interface SchoolDetailClientProps {
  school: School;
  programs: Program[];
  students: SchoolStudent[];
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

export function SchoolDetailClient({
  school,
  programs,
  students,
}: SchoolDetailClientProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="students">
            Students ({students.length})
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
              <span className="text-sm text-muted-foreground">
                {programs.length}{" "}
                {programs.length === 1 ? "program" : "programs"}
              </span>
            </div>

            {programs.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
                <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No programs created yet for this school
                </p>
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
                              {new Date(program.start_date).toLocaleDateString()}
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Students Tab */}
        <TabsContent value="students" className="mt-6">
          {students.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No students enrolled at this school yet
              </p>
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
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr
                      key={student.id}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-6">
          <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">Schedule coming soon</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              View and manage session schedules for all programs at this school.
            </p>
          </div>
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="mt-6">
          <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
            <CreditCard className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">
              Payments coming soon
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Track invoices, payments, and revenue for this school.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <SchoolFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        school={school}
      />
    </div>
  );
}
