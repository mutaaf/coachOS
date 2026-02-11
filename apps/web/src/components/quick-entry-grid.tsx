"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type ColumnConfig = {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
};

interface QuickEntryGridProps {
  columns: ColumnConfig[];
  onImport: (rows: Record<string, string>[]) => Promise<{ created: number; errors: { row: number; message: string }[] }>;
}

function createEmptyRows(columns: ColumnConfig[], count: number): Record<string, string>[] {
  return Array.from({ length: count }, () =>
    Object.fromEntries(columns.map((col) => [col.key, ""]))
  );
}

export function QuickEntryGrid({ columns, onImport }: QuickEntryGridProps) {
  const [rows, setRows] = useState<Record<string, string>[]>(() =>
    createEmptyRows(columns, 5)
  );
  const [errorRows, setErrorRows] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);

  function updateCell(rowIndex: number, key: string, value: string) {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [key]: value };
      return updated;
    });
    // Clear error for this row when user types
    if (errorRows[rowIndex]) {
      setErrorRows((prev) => {
        const updated = { ...prev };
        delete updated[rowIndex];
        return updated;
      });
    }
  }

  function addMoreRows() {
    setRows((prev) => [...prev, ...createEmptyRows(columns, 5)]);
  }

  function isRowEmpty(row: Record<string, string>): boolean {
    return columns.every((col) => !row[col.key]?.trim());
  }

  async function handleImport() {
    const filledRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !isRowEmpty(row));

    if (filledRows.length === 0) {
      toast.error("No data to import. Fill in at least one row.");
      return;
    }

    setImporting(true);
    setErrorRows({});

    try {
      const result = await onImport(filledRows.map(({ row }) => row));

      if (result.errors.length > 0) {
        const newErrorRows: Record<number, string> = {};
        for (const err of result.errors) {
          if (err.row >= 0) {
            // Map back from filtered index to original row index
            const originalIndex = filledRows[err.row]?.index ?? err.row;
            newErrorRows[originalIndex] = err.message;
          }
        }
        setErrorRows(newErrorRows);
      }

      if (result.created > 0) {
        toast.success(`Imported ${result.created} record${result.created !== 1 ? "s" : ""} successfully`);
        // Remove successfully imported rows, keep error rows
        if (result.errors.length === 0) {
          setRows(createEmptyRows(columns, 5));
        }
      }

      if (result.errors.length > 0 && result.created === 0) {
        toast.error("Import failed. Check highlighted rows for errors.");
      }
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
              {columns.map((col) => (
                <th key={col.key} className="p-2 text-left text-xs font-medium text-muted-foreground">
                  {col.label}
                  {col.required && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={`border-b last:border-0 ${errorRows[rowIndex] ? "bg-red-50" : ""}`}
              >
                <td className="p-2 text-xs text-muted-foreground">{rowIndex + 1}</td>
                {columns.map((col) => (
                  <td key={col.key} className="p-1">
                    <Input
                      value={row[col.key] || ""}
                      onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                      placeholder={col.placeholder || col.label}
                      className={`h-8 text-sm ${
                        errorRows[rowIndex] && col.required && !row[col.key]?.trim()
                          ? "border-red-500"
                          : ""
                      }`}
                      disabled={importing}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(errorRows).length > 0 && (
        <div className="text-sm text-red-600 space-y-1">
          {Object.entries(errorRows).map(([row, msg]) => (
            <p key={row}>Row {Number(row) + 1}: {msg}</p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={addMoreRows} disabled={importing}>
          <Plus className="h-4 w-4 mr-1" />
          Add 5 More Rows
        </Button>
        <Button onClick={handleImport} disabled={importing}>
          {importing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {importing ? "Importing..." : "Import All"}
        </Button>
      </div>
    </div>
  );
}
