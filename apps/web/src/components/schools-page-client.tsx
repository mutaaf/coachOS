"use client";

import { RosterImportDialog, type ImportSchoolOption } from "@/components/roster-import-dialog";

import { useState } from "react";
import Link from "next/link";
import { School as SchoolIcon, MapPin, Users, Plus, GraduationCap, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SchoolFormDialog } from "@/components/school-form-dialog";
import { BulkImportDialog } from "@/components/bulk-import-dialog";
import type { School } from "@/types/database";

type SchoolWithCounts = School & {
  program_count: number;
  student_count: number;
};

interface SchoolsPageClientProps {
  schools: SchoolWithCounts[];
  importOptions: ImportSchoolOption[];
  defaultMonthlyFee: string;
}

function getStatusBadgeVariant(
  status: School["status"]
): "success" | "secondary" | "warning" {
  switch (status) {
    case "active":
      return "success";
    case "inactive":
      return "secondary";
    case "archived":
      return "warning";
    default:
      return "secondary";
  }
}

export function SchoolsPageClient({ schools, importOptions, defaultMonthlyFee }: SchoolsPageClientProps) {
  const [rosterOpen, setRosterOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | undefined>(
    undefined
  );

  function handleAddSchool() {
    setEditingSchool(undefined);
    setDialogOpen(true);
  }

  function handleEditSchool(school: School) {
    setEditingSchool(school);
    setDialogOpen(true);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Schools</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your partner schools and sessions
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button data-tour="import-roster" onClick={() => setRosterOpen(true)} className="h-11 w-full gap-2 sm:h-10 sm:w-auto">
            <Users className="h-4 w-4" />
            Import a roster
          </Button>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" onClick={() => setBulkOpen(true)} className="h-11 gap-2 sm:h-10">
              <Upload className="h-4 w-4" />
              Bulk Import
            </Button>
            <Button variant="outline" onClick={handleAddSchool} className="h-11 gap-2 sm:h-10">
              <Plus className="h-4 w-4" />
              Add School
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {schools.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-white p-6 sm:p-12 mt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <SchoolIcon className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">No schools yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4 text-center max-w-sm">
            The quickest start: import a session&apos;s roster from a screenshot or
            a spreadsheet. The school and session are created as you go.
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
            <Button onClick={() => setRosterOpen(true)} className="h-11 gap-2 sm:h-10">
              <Users className="h-4 w-4" />
              Import a roster
            </Button>
            <Button variant="outline" onClick={handleAddSchool} className="h-11 gap-2 sm:h-10">
              <Plus className="h-4 w-4" />
              Add a school by hand
            </Button>
          </div>
        </div>
      ) : (
        /* School cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-6">
          {schools.map((school) => (
            <Link
              key={school.id}
              href={`/schools/${school.id}`}
              className="group block"
            >
              <div className="rounded-2xl border bg-white p-5 sm:p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <SchoolIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-base group-hover:text-primary transition-colors">
                        {school.name}
                      </h3>
                    </div>
                  </div>
                  <Badge variant={getStatusBadgeVariant(school.status)} className="shrink-0">
                    {school.status}
                  </Badge>
                </div>

                {school.address && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{school.address}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 border-t tabular-nums">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>
                      {school.student_count}{" "}
                      {school.student_count === 1 ? "student" : "students"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <GraduationCap className="h-3.5 w-3.5" />
                    <span>
                      {school.program_count}{" "}
                      {school.program_count === 1 ? "session" : "sessions"}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Bulk Import Dialog */}
      <BulkImportDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        entityType="schools"
      />

      {/* Form Dialog */}
      <SchoolFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingSchool(undefined);
        }}
        school={editingSchool}
      />
      <RosterImportDialog open={rosterOpen} onOpenChange={setRosterOpen} schools={importOptions}
        defaultMonthlyFee={defaultMonthlyFee}
      />
    </div>
  );
}
