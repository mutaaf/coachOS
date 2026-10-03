"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkRoster, importRoster, readRosterSource } from "@/lib/actions/roster-import";
import type { RosterRow, RowCheck } from "@/lib/roster";
import { AlertTriangle, Check, FileSpreadsheet, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";

export interface ImportSchoolOption {
  id: string;
  name: string;
  programs: { id: string; name: string; monthly_fee: number }[];
}

const NEW = "__new__";

/**
 * Phone screenshots are often 3–5MB; the reader gains nothing past ~1600px on
 * the long edge, and a server action refuses bodies over its limit. Shrink in
 * the browser before sending.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
}

const FIELDS: { key: keyof RosterRow; label: string; type?: string; wide?: boolean }[] = [
  { key: "child_first_name", label: "Child first name" },
  { key: "child_last_name", label: "Child last name" },
  { key: "parent_first_name", label: "Parent first name" },
  { key: "parent_last_name", label: "Parent last name" },
  { key: "parent_phone", label: "Parent phone", type: "tel" },
  { key: "grade", label: "Grade" },
  { key: "parent_email", label: "Parent email", type: "email", wide: true },
];

const emptyRow = (): RosterRow => ({
  child_first_name: null,
  child_last_name: null,
  grade: null,
  parent_first_name: null,
  parent_last_name: null,
  parent_phone: null,
  parent_email: null,
});

type Step = "where" | "upload" | "review" | "done";

export function RosterImportDialog({
  open,
  onOpenChange,
  schools,
  initialSchoolId,
  initialProgramId,
  defaultMonthlyFee = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schools: ImportSchoolOption[];
  initialSchoolId?: string;
  initialProgramId?: string;
  /** Default Monthly Fee from Settings, for a session made by the import. */
  defaultMonthlyFee?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("where");
  const [schoolId, setSchoolId] = useState(initialSchoolId ?? (schools.length ? schools[0].id : NEW));
  const [newSchool, setNewSchool] = useState("");
  const [programId, setProgramId] = useState(initialProgramId ?? NEW);
  const [newProgram, setNewProgram] = useState("");
  const [fee, setFee] = useState(defaultMonthlyFee);

  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [checks, setChecks] = useState<RowCheck[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const school = schools.find((s) => s.id === schoolId);
  const programs = school?.programs ?? [];
  const realProgramId = programId === NEW ? null : programId;

  useEffect(() => {
    if (!open) return;
    setStep(initialProgramId ? "upload" : "where");
    setSchoolId(initialSchoolId ?? (schools.length ? schools[0].id : NEW));
    setProgramId(initialProgramId ?? NEW);
    setFiles([]);
    setText("");
    setRows([]);
    setChecks([]);
    setNotes([]);
    setError(null);
    setResult(null);
    // Only when the dialog opens; the rest is the user's to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A program list from a different school no longer applies.
  useEffect(() => {
    if (programId !== NEW && !programs.some((p) => p.id === programId)) setProgramId(programs[0]?.id ?? NEW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const whereLabel = [
    schoolId === NEW ? newSchool : school?.name,
    programId === NEW ? newProgram : programs.find((p) => p.id === programId)?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  function whereProblem() {
    if (schoolId === NEW && !newSchool.trim()) return "Type the school's name.";
    if (programId === NEW && !newProgram.trim()) return "Name the session — e.g. “Lil Dribblers, Tue 4pm”.";
    if (programId === NEW && (fee.trim() === "" || !(Number(fee) >= 0))) return "Enter the monthly fee (0 if it's free).";
    return null;
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const shrunk = await Promise.all(Array.from(list).map(shrinkImage));
    setFiles((prev) => [...prev, ...shrunk]);
  }

  async function runCheck(next: RosterRow[]) {
    const res = await checkRoster(realProgramId, next);
    if ("checks" in res && res.checks) setChecks(res.checks);
  }

  async function read() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.set("text", text);
    const res = await readRosterSource(fd);
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    if ("rows" in res && res.rows) {
      setRows(res.rows);
      setNotes(res.notes ?? []);
      setStep("review");
      await runCheck(res.rows);
    }
  }

  function edit(i: number, key: keyof RosterRow, value: string) {
    setRows((prev) =>
      prev.map((r, j) =>
        j === i ? { ...r, [key]: value || null, uncertain: r.uncertain?.filter((u) => u !== key) } : r
      )
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await importRoster(
      {
        schoolId: schoolId === NEW ? undefined : schoolId,
        newSchoolName: schoolId === NEW ? newSchool : undefined,
        programId: realProgramId ?? undefined,
        newProgram: programId === NEW ? { name: newProgram, monthlyFee: Number(fee) } : undefined,
      },
      rows
    );
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    setResult(res);
    setStep("done");
    router.refresh();
  }

  // A child she withdrew is left off unless she ticks them, so isn't counted
  // as ready — or as needing a fix.
  const leftOff = rows.filter((r, i) => {
    const check = checks[i];
    return check?.ok && check.withdrawn && !r.rejoin;
  }).length;
  const ready = checks.filter((c) => c?.ok).length - leftOff;
  const needsLook = rows.length - ready - leftOff;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Import a roster</DialogTitle>
          {step !== "where" && whereLabel && (
            <p className="text-sm text-muted-foreground">{whereLabel}</p>
          )}
        </DialogHeader>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "where" && (
          <div className="mt-5 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="roster-school">School</Label>
              <Select
                id="roster-school"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                options={[
                  ...schools.map((s) => ({ value: s.id, label: s.name })),
                  { value: NEW, label: "+ New school" },
                ]}
              />
              {schoolId === NEW && (
                <Input
                  aria-label="New school name"
                  placeholder="School name, e.g. FCA"
                  value={newSchool}
                  onChange={(e) => setNewSchool(e.target.value)}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="roster-program">Session</Label>
              <Select
                id="roster-program"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                options={[
                  ...programs.map((p) => ({ value: p.id, label: `${p.name} ($${Number(p.monthly_fee)}/mo)` })),
                  { value: NEW, label: "+ New session" },
                ]}
              />
              {programId === NEW && (
                <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                  <Input
                    aria-label="New session name"
                    placeholder="e.g. Lil Dribblers, Tue 4pm"
                    value={newProgram}
                    onChange={(e) => setNewProgram(e.target.value)}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      aria-label="Monthly fee"
                      inputMode="decimal"
                      className="pl-6 pr-10"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/mo</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => {
                  const problem = whereProblem();
                  if (problem) return setError(problem);
                  setError(null);
                  setStep("upload");
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="mt-5 space-y-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition hover:bg-muted/40"
            >
              <span className="flex gap-2 text-muted-foreground">
                <ImagePlus className="h-6 w-6" />
                <FileSpreadsheet className="h-6 w-6" />
              </span>
              <span className="font-medium">Add screenshots or a CSV</span>
              <span className="text-xs text-muted-foreground">
                A spreadsheet, a sign-up sheet, the WhatsApp group&apos;s member list — whatever has the names and numbers.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.csv,.tsv,text/csv"
              className="hidden"
              data-testid="roster-files"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="roster-text" className="text-sm">Or paste it</Label>
              <Textarea
                id="roster-text"
                rows={4}
                placeholder={"Mia Garcia, Raquel Garcia, 915-500-2487\nAda Okafor, Star Okafor, 972-891-8266"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("where")} disabled={busy}>
                Back
              </Button>
              <Button onClick={read} disabled={busy || (!files.length && !text.trim())}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading…
                  </>
                ) : (
                  "Read roster"
                )}
              </Button>
            </div>
            {busy && files.some((f) => f.type.startsWith("image/")) && (
              <p className="text-center text-xs text-muted-foreground">Screenshots take about half a minute.</p>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{rows.length}</span> {rows.length === 1 ? "child" : "children"} found.
              {needsLook > 0 ? (
                <span className="text-amber-700"> {needsLook} need{needsLook === 1 ? "s" : ""} a fix before they can be added.</span>
              ) : (
                " Check the details, then import."
              )}
            </p>
            {notes.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}

            <ol className="space-y-3">
              {rows.map((row, i) => {
                const check = checks[i];
                return (
                  <li
                    key={i}
                    data-testid="roster-row"
                    className={`rounded-xl border p-3 ${check && !check.ok ? "border-amber-300 bg-amber-50/40" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {[row.child_first_name, row.child_last_name].filter(Boolean).join(" ") || "Unnamed child"}
                        </p>
                        {check?.ok && check.withdrawn ? (
                          <div className="mt-0.5 space-y-1 text-xs">
                            <p className="flex items-start gap-1 text-amber-800">
                              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> You withdrew this child from this
                              session. They won&apos;t be added back.
                            </p>
                            <label className="flex items-center gap-2 text-foreground">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={!!row.rejoin}
                                onChange={(e) =>
                                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, rejoin: e.target.checked } : r)))
                                }
                              />
                              Put them back on this session (their invoices start again)
                            </label>
                          </div>
                        ) : check?.ok ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700">
                            <Check className="h-3.5 w-3.5 shrink-0" />
                            {check.alreadyEnrolled
                              ? "Already in this session"
                              : check.existingParent
                                ? `Parent on file: ${check.existingParent}`
                                : "Ready"}
                          </p>
                        ) : check ? (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-800">
                            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {check.problem}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() => {
                          const next = rows.filter((_, j) => j !== i);
                          setRows(next);
                          runCheck(next);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5">
                      {FIELDS.map((f) => (
                        <label key={f.key} className={`block ${f.wide ? "col-span-2" : ""}`}>
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {f.label}
                          </span>
                          <Input
                            aria-label={`${f.label}, row ${i + 1}`}
                            type={f.type ?? "text"}
                            value={(row[f.key] as string | null) ?? ""}
                            onChange={(e) => edit(i, f.key, e.target.value)}
                            onBlur={() => runCheck(rows)}
                            className={`mt-0.5 h-11 ${row.uncertain?.includes(f.key) ? "border-amber-400 bg-amber-50" : ""}`}
                          />
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = [...rows, emptyRow()];
                setRows(next);
                runCheck(next);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add a child
            </Button>

            <div className="sticky -bottom-6 -mx-6 -mb-6 flex justify-between gap-2 border-t bg-background px-6 py-4">
              <Button variant="ghost" onClick={() => setStep("upload")} disabled={busy}>
                Back
              </Button>
              <Button onClick={save} disabled={busy || ready === 0}>
                {busy ? "Importing…" : `Import ${ready} ${ready === 1 ? "child" : "children"}`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-900">
                {result.enrolled} {result.enrolled === 1 ? "child" : "children"} added to {whereLabel || "the session"}.
              </p>
              <p className="mt-1 text-sm text-emerald-800">
                {result.newParents} new {result.newParents === 1 ? "family" : "families"}
                {result.alreadyEnrolled > 0 && ` · ${result.alreadyEnrolled} were already on the roster`}
              </p>
            </div>
            {result.keptWithdrawn?.length > 0 && (
              <div className="rounded-xl border p-4 text-sm">
                <p className="font-medium">
                  {result.keptWithdrawn.length} you withdrew {result.keptWithdrawn.length === 1 ? "was" : "were"} left off,
                  and won&apos;t be invoiced:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {result.keptWithdrawn.map((i: number) => (
                    <li key={i}>
                      {[rows[i]?.child_first_name, rows[i]?.child_last_name].filter(Boolean).join(" ") || `Row ${i + 1}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.skipped?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">{result.skipped.length} not added:</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.skipped.map((s: any) => (
                    <li key={s.row}>
                      {[rows[s.row]?.child_first_name, rows[s.row]?.child_last_name].filter(Boolean).join(" ") ||
                        `Row ${s.row + 1}`}
                      : {s.problem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRows([]);
                    setChecks([]);
                    setFiles([]);
                    setText("");
                    setNotes([]);
                    setResult(null);
                    setSchoolId(result.schoolId);
                    setProgramId(NEW);
                    setNewProgram("");
                    setStep("where");
                  }}
                >
                  Import another session
                </Button>
                <Link href="/payments" className={buttonVariants()}>
                  Send payment links
                </Link>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
