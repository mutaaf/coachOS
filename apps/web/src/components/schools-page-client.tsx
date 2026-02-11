"use client";

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

export function SchoolsPageClient({ schools }: SchoolsPageClientProps) {
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
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schools</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your partner schools and programs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Bulk Import
          </Button>
          <Button onClick={handleAddSchool} className="gap-2">
            <Plus className="h-4 w-4" />
            Add School
          </Button>
        </div>
      </div>

      {/* Content */}
      {schools.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-white p-12 mt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <SchoolIcon className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">No schools yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4 text-center max-w-sm">
            Get started by adding your first partner school. You can then create
            programs and enroll students.
          </p>
          <Button onClick={handleAddSchool} className="gap-2">
            <Plus className="h-4 w-4" />
            Add your first school
          </Button>
        </div>
      ) : (
        /* School cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          {schools.map((school) => (
            <Link
              key={school.id}
              href={`/schools/${school.id}`}
              className="group block"
            >
              <div className="rounded-2xl border bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <SchoolIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                        {school.name}
                      </h3>
                    </div>
                  </div>
                  <Badge variant={getStatusBadgeVariant(school.status)}>
                    {school.status}
                  </Badge>
                </div>

                {school.address && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{school.address}</span>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-3 border-t">
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
                      {school.program_count === 1 ? "program" : "programs"}
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
    </>
  );
}
