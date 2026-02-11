"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ClipboardPaste, ArrowRight, Upload, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ColumnConfig } from "@/components/quick-entry-grid";

interface PasteImportProps {
  columns: ColumnConfig[];
  onImport: (rows: Record<string, string>[]) => Promise<{ created: number; errors: { row: number; message: string }[] }>;
  entityType: "schools" | "students" | "parents";
}

const PASTE_PLACEHOLDERS: Record<string, string> = {
  schools: `Paste school names, one per line. Examples:
Lincoln Elementary
Washington Middle School, 123 Main St
Jefferson Academy`,
  students: `Paste student names, one per line. Examples:
John Smith
Jane Doe, Grade 5
Michael Johnson`,
  parents: `Paste contacts from WhatsApp or your phone. Examples:
John Smith 555-123-4567
+1 (555) 987-6543 Jane Doe
Maria Garcia, 555-456-7890, maria@email.com`,
};

function extractPhone(text: string): { phone: string; remainder: string } {
  // Match various phone formats
  const phoneRegex = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
  const match = text.match(phoneRegex);
  if (match) {
    const phone = match[0].replace(/[\s().-]/g, "");
    const remainder = text.replace(match[0], "").trim().replace(/^[,\s]+|[,\s]+$/g, "");
    return { phone, remainder };
  }
  return { phone: "", remainder: text.trim() };
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function parseLines(text: string, entityType: string): Record<string, string>[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results: Record<string, string>[] = [];

  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((p) => p.trim());

    if (entityType === "schools") {
      const name = parts[0] || "";
      const address = parts[1] || "";
      const contact_name = parts[2] || "";
      const contact_phone = parts[3] || "";
      results.push({ name, address, contact_name, contact_phone });
    } else if (entityType === "students") {
      const { first, last } = splitName(parts[0] || "");
      const grade = parts[1] || "";
      const parent_name = parts[2] || "";
      const parent_phone = parts[3] || "";
      results.push({ first_name: first, last_name: last, grade, parent_name, parent_phone });
    } else if (entityType === "parents") {
      // Smart parse: extract phone number first, rest is name
      const fullText = line.replace(/[,\t]+/g, " ").trim();
      const { phone, remainder } = extractPhone(fullText);

      // Check if there's an email in the remainder
      const emailRegex = /[\w.+-]+@[\w.-]+\.\w+/;
      const emailMatch = remainder.match(emailRegex);
      const email = emailMatch ? emailMatch[0] : "";
      const nameText = emailMatch
        ? remainder.replace(emailMatch[0], "").trim().replace(/^[,\s]+|[,\s]+$/g, "")
        : remainder;

      const { first, last } = splitName(nameText);
      results.push({
        first_name: first,
        last_name: last,
        phone,
        email,
        preferred_payment: "",
      });
    }
  }

  return results;
}

export function PasteImport({ columns, onImport, entityType }: PasteImportProps) {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<Record<string, string>[] | null>(null);
  const [errorRows, setErrorRows] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);

  function handleParse() {
    if (!rawText.trim()) {
      toast.error("Please paste some data first.");
      return;
    }
    const result = parseLines(rawText, entityType);
    if (result.length === 0) {
      toast.error("Could not parse any records from the pasted text.");
      return;
    }
    setParsed(result);
    toast.success(`Parsed ${result.length} record${result.length !== 1 ? "s" : ""}. Review and edit below before importing.`);
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    if (!parsed) return;
    setParsed((prev) => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [key]: value };
      return updated;
    });
    if (errorRows[rowIndex]) {
      setErrorRows((prev) => {
        const updated = { ...prev };
        delete updated[rowIndex];
        return updated;
      });
    }
  }

  function handleReset() {
    setParsed(null);
    setErrorRows({});
  }

  async function handleImport() {
    if (!parsed || parsed.length === 0) return;

    setImporting(true);
    setErrorRows({});

    try {
      const result = await onImport(parsed);

      if (result.errors.length > 0) {
        const newErrorRows: Record<number, string> = {};
        for (const err of result.errors) {
          if (err.row >= 0) {
            newErrorRows[err.row] = err.message;
          }
        }
        setErrorRows(newErrorRows);
      }

      if (result.created > 0) {
        toast.success(`Imported ${result.created} record${result.created !== 1 ? "s" : ""} successfully`);
        if (result.errors.length === 0) {
          setParsed(null);
          setRawText("");
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

  // Phase 1: Paste text
  if (!parsed) {
    return (
      <div className="space-y-4">
        <Textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={PASTE_PLACEHOLDERS[entityType] || "Paste data here..."}
          rows={10}
          className="font-mono text-sm"
        />
        <div className="flex justify-end">
          <Button onClick={handleParse} disabled={!rawText.trim()}>
            <ClipboardPaste className="h-4 w-4 mr-2" />
            Parse Data
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Phase 2: Review & edit parsed results
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {parsed.length} record{parsed.length !== 1 ? "s" : ""} parsed. Review and edit before importing.
        </p>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Start Over
        </Button>
      </div>

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
            {parsed.map((row, rowIndex) => (
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

      <div className="flex justify-end">
        <Button onClick={handleImport} disabled={importing}>
          {importing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {importing ? "Importing..." : `Import ${parsed.length} Record${parsed.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
