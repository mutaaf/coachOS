"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StudentFormDialog } from "@/components/student-form-dialog";
import { ParentFormDialog } from "@/components/parent-form-dialog";
import { EnrollStudentDialog } from "@/components/enroll-student-dialog";
import type { EnrollableProgram } from "@/components/enroll-student-dialog";
import { Users, UserPlus, Search, Phone, Mail, GraduationCap, Plus, Upload, Pencil, Link2, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { BulkImportDialog } from "@/components/bulk-import-dialog";
import { LinkParentDialog } from "@/components/link-parent-dialog";
import { deleteStudent, deleteParent, archiveStudent, restoreStudent } from "@/lib/actions/students";
import { useAction } from "@/lib/use-action";
import { toast } from "sonner";
import type { Student, Parent } from "@/types/database";
import { matchesPhone, searchable } from "@/lib/identity";
import { cn, formatCurrency, formatPhone } from "@/lib/utils";
import { familyHref } from "@/lib/family-link";
import Link from "next/link";
import type { StudentEnrollmentInfo, ParentWithStudents } from "@/lib/queries/students";

type StudentWithParents = Student & {
  parents: (Parent & { relationship: string })[];
  enrollments: StudentEnrollmentInfo[];
};

interface StudentsPageClientProps {
  students: StudentWithParents[];
  parents: ParentWithStudents[];
  enrollablePrograms: EnrollableProgram[];
  /** What each parent's family owes, and their credit, by parent id. */
  balances: Record<string, { owedCents: number; creditCents: number }>;
}

export function StudentsPageClient({ students, parents, enrollablePrograms, balances }: StudentsPageClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showParentForm, setShowParentForm] = useState(false);
  const [bulkStudentsOpen, setBulkStudentsOpen] = useState(false);
  const [bulkParentsOpen, setBulkParentsOpen] = useState(false);
  const [enrollStudent, setEnrollStudent] = useState<{ id: string; name: string } | null>(null);
  const [editingStudent, setEditingStudent] = useState<StudentWithParents | undefined>();
  const [editingParent, setEditingParent] = useState<ParentWithStudents | undefined>();
  const [linkingStudent, setLinkingStudent] = useState<StudentWithParents | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { run } = useAction();

  const archivedCount = students.filter((s) => s.status === "inactive").length;

  // Accents are ignored: "nunez" finds Núñez.
  const q = searchable(search);

  const filteredStudents = students.filter((s) => {
    if (!showArchived && s.status === "inactive") return false;
    return (
      searchable(`${s.first_name} ${s.last_name}`).includes(q) ||
      s.parents.some((p) => searchable(`${p.first_name} ${p.last_name}`).includes(q) || matchesPhone(p.phone, search)) ||
      s.enrollments.some(
        (e) => searchable(e.schoolName).includes(q) || searchable(e.programName).includes(q)
      )
    );
  });

  async function removeStudent(student: StudentWithParents) {
    if (!window.confirm(`Delete ${student.first_name} ${student.last_name}?`)) return;
    const result = await deleteStudent(student.id);
    if ("canArchive" in result && result.canArchive) {
      // Their payment history stays, so offer the tidy-up that keeps it.
      if (window.confirm(`${result.error}\n\nArchive ${student.first_name} ${student.last_name} now?`)) {
        await run(() => archiveStudent(student.id), { success: "Student archived" });
      }
    } else if (result.error) toast.error(result.error);
    else { toast.success("Student deleted"); router.refresh(); }
  }

  async function removeParent(parent: ParentWithStudents) {
    if (!window.confirm(`Delete ${parent.first_name} ${parent.last_name}?`)) return;
    const result = await deleteParent(parent.id);
    if (result.error) toast.error(result.error);
    else { toast.success("Parent deleted"); router.refresh(); }
  }

  const toggleArchive = (student: StudentWithParents) =>
    student.status === "inactive"
      ? run(() => restoreStudent(student.id), { success: "Student restored" })
      : run(() => archiveStudent(student.id), { success: "Student archived" });

  const filteredParents = parents.filter(
    (p) =>
      searchable(`${p.first_name} ${p.last_name}`).includes(q) ||
      // On the digits: "(214) 555" finds a number saved as +12145551000.
      matchesPhone(p.phone, search) ||
      (p.email && searchable(p.email).includes(q))
  );

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Students & Parents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every child, the family behind them, and what each family owes.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:shrink-0 lg:flex-nowrap">
          <div className="order-2 grid grid-cols-2 gap-2 sm:order-1 sm:flex sm:flex-wrap lg:flex-nowrap">
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => setBulkStudentsOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Bulk Students
            </Button>
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => setBulkParentsOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Bulk Parents
            </Button>
            <Button variant="outline" className="col-span-2 h-11 sm:h-10" onClick={() => setShowParentForm(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Add Parent
            </Button>
          </div>
          <Button className="order-1 h-11 w-full sm:order-2 sm:h-10 sm:w-auto" onClick={() => setShowStudentForm(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Student
          </Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 pl-10 text-base sm:h-10 sm:text-sm"
        />
      </div>

      <Tabs defaultValue="students">
        <TabsList data-tour="student-tabs" className="h-12 w-full sm:h-10 sm:w-auto">
          <TabsTrigger value="students" className="h-10 flex-1 tabular-nums sm:h-auto sm:flex-none">
            Students ({filteredStudents.length})
          </TabsTrigger>
          <TabsTrigger value="parents" className="h-10 flex-1 tabular-nums sm:h-auto sm:flex-none">
            Parents ({filteredParents.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          {archivedCount > 0 && (
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="sm" className="h-11 sm:h-9" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
              </Button>
            </div>
          )}
          {filteredStudents.length === 0 ? (
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              {search ? (
                <>
                  <h3 className="text-lg font-medium mb-2">No students match &ldquo;{search}&rdquo;</h3>
                  <p className="text-muted-foreground mb-4">Try a first name, a parent&apos;s name, or a phone number.</p>
                  <Button variant="outline" className="h-11 sm:h-10" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium mb-2">No students yet</h3>
                  <p className="text-muted-foreground mb-4">Add your first student to get started.</p>
                  <Button className="h-11 sm:h-10" onClick={() => setShowStudentForm(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Add Student
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
            <ul className="space-y-3 md:hidden">
              {filteredStudents.map((student) => {
                const name = `${student.first_name} ${student.last_name}`;
                const meta = [
                  student.grade ? `Grade ${student.grade}` : null,
                  student.parents.length === 0
                    ? "No parents linked"
                    : student.parents.map((p) => `${p.first_name} ${p.last_name}`).join(", "),
                ].filter(Boolean).join(" · ");
                return (
                  <li key={student.id} className="rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-medium">
                          {student.parents[0] ? (
                            <Link href={familyHref(student.parents[0].id)} className="-my-[13px] inline-block py-[13px] hover:underline">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{meta}</p>
                        {student.enrollments.length === 0 ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">Not enrolled</p>
                        ) : (
                          student.enrollments.map((e, i) => (
                            <p key={i} className="mt-0.5 truncate text-sm">
                              {e.schoolName}
                              <span className="text-muted-foreground"> — {e.programName}</span>
                            </p>
                          ))
                        )}
                        {student.medical_notes && (
                          <p className="mt-0.5 text-xs text-orange-600">Medical notes on file</p>
                        )}
                        {student.photo_release !== true && (
                          <p className="mt-0.5 text-xs text-red-700">No photo release — don&apos;t post</p>
                        )}
                      </div>
                      <Badge variant={student.status === "active" ? "success" : "secondary"} className="shrink-0">
                        {student.status === "inactive" ? "archived" : student.status}
                      </Badge>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="outline"
                        className="h-11 min-w-0 flex-1 px-2"
                        onClick={() => setEnrollStudent({ id: student.id, name })}
                      >
                        Enroll
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 min-w-0 flex-1 px-2"
                        aria-label={`Link parents to ${name}`}
                        onClick={() => setLinkingStudent(student)}
                      >
                        Parents
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 w-11 shrink-0 p-0"
                        aria-label={`Edit ${name}`}
                        onClick={() => setEditingStudent(student)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 w-11 shrink-0 p-0"
                        aria-label={student.status === "inactive" ? `Restore ${name}` : `Archive ${name}`}
                        onClick={() => toggleArchive(student)}
                      >
                        {student.status === "inactive" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 w-11 shrink-0 p-0 text-destructive hover:text-destructive"
                        aria-label={`Delete ${name}`}
                        onClick={() => removeStudent(student)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden rounded-2xl border bg-card overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Grade</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Parents</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Schools & Sessions</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student) => (
                    <tr key={student.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4">
                        <div className="font-medium">
                          {student.parents[0] ? (
                            <Link href={familyHref(student.parents[0].id)} className="hover:underline">
                              {student.first_name} {student.last_name}
                            </Link>
                          ) : (
                            `${student.first_name} ${student.last_name}`
                          )}
                        </div>
                        {student.medical_notes && (
                          <div className="text-xs text-orange-600 mt-0.5">Medical notes on file</div>
                        )}
                        {student.photo_release !== true && (
                          <div className="text-xs text-red-700 mt-0.5">No photo release — don&apos;t post</div>
                        )}
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <GraduationCap className="h-3.5 w-3.5" />
                          {student.grade || "—"}
                        </div>
                      </td>
                      <td className="p-4 hidden md:table-cell">
                        <div className="text-sm">
                          {student.parents.length === 0 ? (
                            <span className="text-muted-foreground">No parents linked</span>
                          ) : (
                            student.parents.map((p) => `${p.first_name} ${p.last_name}`).join(", ")
                          )}
                        </div>
                      </td>
                      <td className="p-4 hidden lg:table-cell">
                        <div className="text-sm">
                          {student.enrollments.length === 0 ? (
                            <span className="text-muted-foreground">Not enrolled</span>
                          ) : (
                            student.enrollments.map((e, i) => (
                              <div key={i}>
                                <span className="font-medium">{e.schoolName}</span>
                                <span className="text-muted-foreground"> — {e.programName}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant={student.status === "active" ? "success" : "secondary"}>
                          {student.status === "inactive" ? "archived" : student.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingStudent(student)}
                          title="Edit student"
                          aria-label="Edit student"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLinkingStudent(student)}
                          title="Link parents"
                          aria-label="Link parents"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEnrollStudent({ id: student.id, name: `${student.first_name} ${student.last_name}` })}
                        >
                          Enroll
                        </Button>
                        {student.status === "inactive" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Restore student"
                            aria-label="Restore student"
                            onClick={() => toggleArchive(student)}
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Archive student"
                            aria-label="Archive student"
                            onClick={() => toggleArchive(student)}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          title="Delete student"
                          aria-label="Delete student"
                          onClick={() => removeStudent(student)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="parents">
          {filteredParents.length === 0 ? (
            <div className="text-center py-16">
              <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              {search ? (
                <>
                  <h3 className="text-lg font-medium mb-2">No parents match &ldquo;{search}&rdquo;</h3>
                  <p className="text-muted-foreground mb-4">Try a name, a phone number, or an email.</p>
                  <Button variant="outline" className="h-11 sm:h-10" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium mb-2">No parents yet</h3>
                  <p className="text-muted-foreground mb-4">Add a parent to link them to students.</p>
                  <Button className="h-11 sm:h-10" onClick={() => setShowParentForm(true)}>
                    <UserPlus className="h-4 w-4 mr-2" /> Add Parent
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
            <ul className="space-y-3 md:hidden">
              {filteredParents.map((parent) => {
                const balance = balances[parent.id];
                const name = `${parent.first_name} ${parent.last_name}`;
                return (
                  <li key={parent.id} className="rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link href={familyHref(parent.id)} className="-my-[13px] inline-block break-words py-[13px] font-medium hover:underline">
                          {name}
                        </Link>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          <span className="whitespace-nowrap">{formatPhone(parent.phone)}</span>
                          <span className="truncate">· pays by {parent.preferred_payment}</span>
                        </p>
                        {parent.email && (
                          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{parent.email}</span>
                          </p>
                        )}
                        <p className="mt-0.5 truncate text-sm">
                          {parent.students.length === 0 ? (
                            <span className="text-muted-foreground">No students linked</span>
                          ) : (
                            parent.students.map((s) => `${s.first_name} ${s.last_name}`).join(", ")
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {balance?.owedCents ? (
                          <span className="whitespace-nowrap font-semibold tabular-nums text-red-600">
                            {formatCurrency(balance.owedCents / 100)}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-sm text-muted-foreground">Paid up</span>
                        )}
                        {!!balance?.creditCents && (
                          <div className="whitespace-nowrap text-xs tabular-nums text-green-700">
                            {formatCurrency(balance.creditCents / 100)} credit
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Link
                        href={familyHref(parent.id)}
                        className={cn(buttonVariants({ variant: "outline" }), "h-11 min-w-0 flex-1")}
                      >
                        Family page
                      </Link>
                      <Button
                        variant="outline"
                        className="h-11 w-11 shrink-0 p-0"
                        aria-label={`Edit ${name}`}
                        onClick={() => setEditingParent(parent)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 w-11 shrink-0 p-0 text-destructive hover:text-destructive"
                        aria-label={`Delete ${name}`}
                        onClick={() => removeParent(parent)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden rounded-2xl border bg-card overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Phone</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Email</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Linked Students</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Balance</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Payment</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParents.map((parent) => {
                    const balance = balances[parent.id];
                    return (
                    <tr key={parent.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4 font-medium">
                        <Link href={familyHref(parent.id)} className="hover:underline">
                          {parent.first_name} {parent.last_name}
                        </Link>
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" /> {formatPhone(parent.phone)}
                        </div>
                      </td>
                      <td className="p-4 hidden md:table-cell">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" /> {parent.email || "—"}
                        </div>
                      </td>
                      <td className="p-4 hidden lg:table-cell">
                        <div className="text-sm">
                          {parent.students.length === 0 ? (
                            <span className="text-muted-foreground">No students linked</span>
                          ) : (
                            parent.students.map((s, i) => (
                              <span key={s.id}>
                                {i > 0 && ", "}
                                {s.first_name} {s.last_name}
                                <span className="text-muted-foreground"> ({s.relationship})</span>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-4 whitespace-nowrap" data-testid="parent-balance">
                        {balance?.owedCents ? (
                          <span className="font-medium tabular-nums text-red-600">
                            {formatCurrency(balance.owedCents / 100)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Paid up</span>
                        )}
                        {!!balance?.creditCents && (
                          <div className="text-xs text-green-700">{formatCurrency(balance.creditCents / 100)} credit</div>
                        )}
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <Badge variant="outline">{parent.preferred_payment}</Badge>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingParent(parent)}
                          title="Edit parent"
                          aria-label="Edit parent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          title="Delete parent"
                          aria-label="Delete parent"
                          onClick={() => removeParent(parent)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <BulkImportDialog open={bulkStudentsOpen} onOpenChange={setBulkStudentsOpen} entityType="students" />
      <BulkImportDialog open={bulkParentsOpen} onOpenChange={setBulkParentsOpen} entityType="parents" />
      <StudentFormDialog open={showStudentForm} onOpenChange={setShowStudentForm} />
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
      <ParentFormDialog open={showParentForm} onOpenChange={setShowParentForm} />
      <ParentFormDialog
        open={!!editingParent}
        onOpenChange={(open) => {
          if (!open) {
            setEditingParent(undefined);
            router.refresh();
          }
        }}
        parent={editingParent}
      />
      {linkingStudent && (
        <LinkParentDialog
          open={!!linkingStudent}
          onOpenChange={(open) => { if (!open) setLinkingStudent(null); }}
          studentId={linkingStudent.id}
          studentName={`${linkingStudent.first_name} ${linkingStudent.last_name}`}
          linkedParents={linkingStudent.parents}
          allParents={parents}
        />
      )}
      {enrollStudent && (
        <EnrollStudentDialog
          open={!!enrollStudent}
          onOpenChange={() => setEnrollStudent(null)}
          studentId={enrollStudent.id}
          studentName={enrollStudent.name}
          programs={enrollablePrograms}
          studentEnrolledProgramIds={
            students
              .find((s) => s.id === enrollStudent.id)
              ?.enrollments.map((e) => e.programId) || []
          }
        />
      )}
    </div>
  );
}
