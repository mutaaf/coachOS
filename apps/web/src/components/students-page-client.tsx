"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StudentFormDialog } from "@/components/student-form-dialog";
import { ParentFormDialog } from "@/components/parent-form-dialog";
import { EnrollStudentDialog } from "@/components/enroll-student-dialog";
import { Users, UserPlus, Search, Phone, Mail, GraduationCap, Plus, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/bulk-import-dialog";
import type { Student, Parent } from "@/types/database";

type StudentWithParents = Student & { parents: (Parent & { relationship: string })[] };

interface StudentsPageClientProps {
  students: StudentWithParents[];
  parents: Parent[];
}

export function StudentsPageClient({ students, parents }: StudentsPageClientProps) {
  const [search, setSearch] = useState("");
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showParentForm, setShowParentForm] = useState(false);
  const [bulkStudentsOpen, setBulkStudentsOpen] = useState(false);
  const [bulkParentsOpen, setBulkParentsOpen] = useState(false);
  const [enrollStudent, setEnrollStudent] = useState<{ id: string; name: string } | null>(null);

  const filteredStudents = students.filter(
    (s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      s.parents.some((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredParents = parents.filter(
    (p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search) ||
      (p.email && p.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Students & Parents</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkStudentsOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Bulk Students
          </Button>
          <Button variant="outline" onClick={() => setBulkParentsOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Bulk Parents
          </Button>
          <Button variant="outline" onClick={() => setShowParentForm(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Add Parent
          </Button>
          <Button onClick={() => setShowStudentForm(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Student
          </Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Students ({filteredStudents.length})</TabsTrigger>
          <TabsTrigger value="parents">Parents ({filteredParents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          {filteredStudents.length === 0 ? (
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No students yet</h3>
              <p className="text-muted-foreground mb-4">Add your first student to get started.</p>
              <Button onClick={() => setShowStudentForm(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Student
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Grade</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Parents</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student) => (
                    <tr key={student.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4">
                        <div className="font-medium">{student.first_name} {student.last_name}</div>
                        {student.medical_notes && (
                          <div className="text-xs text-orange-600 mt-0.5">Medical notes on file</div>
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
                      <td className="p-4">
                        <Badge variant={student.status === "active" ? "success" : "secondary"}>
                          {student.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEnrollStudent({ id: student.id, name: `${student.first_name} ${student.last_name}` })}
                        >
                          Enroll
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="parents">
          {filteredParents.length === 0 ? (
            <div className="text-center py-16">
              <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No parents yet</h3>
              <p className="text-muted-foreground mb-4">Add a parent to link them to students.</p>
              <Button onClick={() => setShowParentForm(true)}>
                <UserPlus className="h-4 w-4 mr-2" /> Add Parent
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Phone</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Email</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParents.map((parent) => (
                    <tr key={parent.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4 font-medium">{parent.first_name} {parent.last_name}</td>
                      <td className="p-4 hidden sm:table-cell">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" /> {parent.phone}
                        </div>
                      </td>
                      <td className="p-4 hidden md:table-cell">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" /> {parent.email || "—"}
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant="outline">{parent.preferred_payment}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BulkImportDialog open={bulkStudentsOpen} onOpenChange={setBulkStudentsOpen} entityType="students" />
      <BulkImportDialog open={bulkParentsOpen} onOpenChange={setBulkParentsOpen} entityType="parents" />
      <StudentFormDialog open={showStudentForm} onOpenChange={setShowStudentForm} />
      <ParentFormDialog open={showParentForm} onOpenChange={setShowParentForm} />
      {enrollStudent && (
        <EnrollStudentDialog
          open={!!enrollStudent}
          onOpenChange={() => setEnrollStudent(null)}
          studentId={enrollStudent.id}
          studentName={enrollStudent.name}
        />
      )}
    </div>
  );
}
