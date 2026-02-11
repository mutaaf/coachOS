"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QuickEntryGrid, type ColumnConfig } from "@/components/quick-entry-grid";
import { PasteImport } from "@/components/paste-import";
import {
  bulkCreateSchools,
  bulkCreateStudents,
  bulkCreateParents,
  type BulkImportResult,
  type BulkSchoolRow,
  type BulkStudentRow,
  type BulkParentRow,
} from "@/lib/actions/bulk-import";

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "schools" | "students" | "parents";
}

const COLUMN_CONFIGS: Record<string, ColumnConfig[]> = {
  schools: [
    { key: "name", label: "Name", required: true, placeholder: "Lincoln Elementary" },
    { key: "address", label: "Address", required: false, placeholder: "123 Main St" },
    { key: "contact_name", label: "Contact Name", required: false, placeholder: "Jane Smith" },
    { key: "contact_phone", label: "Contact Phone", required: false, placeholder: "555-123-4567" },
  ],
  students: [
    { key: "first_name", label: "First Name", required: true, placeholder: "John" },
    { key: "last_name", label: "Last Name", required: true, placeholder: "Smith" },
    { key: "grade", label: "Grade", required: false, placeholder: "5th" },
    { key: "parent_name", label: "Parent Name", required: false, placeholder: "Jane Smith" },
    { key: "parent_phone", label: "Parent Phone", required: false, placeholder: "555-123-4567" },
  ],
  parents: [
    { key: "first_name", label: "First Name", required: true, placeholder: "Jane" },
    { key: "last_name", label: "Last Name", required: true, placeholder: "Smith" },
    { key: "phone", label: "Phone", required: true, placeholder: "555-123-4567" },
    { key: "email", label: "Email", required: false, placeholder: "jane@email.com" },
    { key: "preferred_payment", label: "Payment Method", required: false, placeholder: "cash / zelle / venmo" },
  ],
};

const TITLES: Record<string, string> = {
  schools: "Bulk Import Schools",
  students: "Bulk Import Students",
  parents: "Bulk Import Parents",
};

const DESCRIPTIONS: Record<string, string> = {
  schools: "Add multiple schools at once using the grid or by pasting data.",
  students: "Add multiple students at once using the grid or by pasting data.",
  parents: "Add multiple parents at once. Paste contacts from WhatsApp or your phone.",
};

async function handleImport(
  entityType: string,
  rows: Record<string, string>[]
): Promise<BulkImportResult> {
  switch (entityType) {
    case "schools":
      return bulkCreateSchools(rows as unknown as BulkSchoolRow[]);
    case "students":
      return bulkCreateStudents(rows as unknown as BulkStudentRow[]);
    case "parents":
      return bulkCreateParents(rows as unknown as BulkParentRow[]);
    default:
      return { created: 0, errors: [{ row: -1, message: "Unknown entity type" }] };
  }
}

export function BulkImportDialog({ open, onOpenChange, entityType }: BulkImportDialogProps) {
  const columns = COLUMN_CONFIGS[entityType];

  async function onImport(rows: Record<string, string>[]): Promise<BulkImportResult> {
    return handleImport(entityType, rows);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLES[entityType]}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[entityType]}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quick-entry">
          <TabsList className="mb-4">
            <TabsTrigger value="quick-entry">Quick Entry</TabsTrigger>
            <TabsTrigger value="paste">Paste & Import</TabsTrigger>
          </TabsList>

          <TabsContent value="quick-entry">
            <QuickEntryGrid columns={columns} onImport={onImport} />
          </TabsContent>

          <TabsContent value="paste">
            <PasteImport columns={columns} onImport={onImport} entityType={entityType} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
