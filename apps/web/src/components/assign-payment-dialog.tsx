"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/lib/use-action";
import { assignUnrecognisedPayment } from "@/lib/actions/payment-assign";
import type { AssignFamily, AssignSchool } from "@/lib/queries/payment-assign";
import type { AssignInput } from "@/lib/payment-assign";
import { formatCurrency, newClientKey } from "@/lib/utils";
import { ArrowLeft, Check, ChevronRight, Search, UserPlus } from "lucide-react";

/**
 * "Who paid this?" — for money from someone CoachOS doesn't recognise.
 *
 * One question per screen, each answer narrowing the next: who paid, then (if
 * they're new or owe nothing) which child it's for, then which school and
 * program — creating whatever doesn't exist yet. The last screen says in plain
 * sentences everything that will happen before anything does.
 */

export type AssignSource =
  | { kind: "zelle"; receiptId: string; sender: string; amount: number; memo?: string | null }
  | { kind: "manual" };

export interface AssignOptions {
  families: AssignFamily[];
  schools: AssignSchool[];
}

type Step = "who" | "new-family" | "child" | "where" | "review";
const NEW = "__new__";

const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** How much a family looks like the person who sent the money. */
function likeness(f: AssignFamily, sender: string) {
  const words = norm(sender).split(/\s+/).filter((w) => w.length > 1);
  const hay = norm(`${f.name} ${f.children.map((c) => `${c.first_name} ${c.last_name}`).join(" ")}`);
  return words.reduce((s, w) => s + (hay.includes(w) ? (w.length > 2 ? 2 : 1) : 0), 0);
}

function splitSender(sender: string): [string, string] {
  const parts = titleCase(sender.trim()).split(/\s+/).filter((p) => !/^\p{L}\.?$/u.test(p));
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

export function AssignPaymentDialog({
  open,
  onOpenChange,
  source,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: AssignSource;
  options: AssignOptions;
}) {
  const { run, pending } = useAction();
  const zelle = source.kind === "zelle" ? source : null;
  const [first0, last0] = zelle ? splitSender(zelle.sender) : ["", ""];

  const [step, setStep] = useState<Step>("who");
  const [history, setHistory] = useState<Step[]>([]);
  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const back = () => {
    setStep(history[history.length - 1] ?? "who");
    setHistory((h) => h.slice(0, -1));
  };

  // The money (typed in, for cash and the like)
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "zelle" | "venmo">("cash");
  const cents = zelle ? Math.round(zelle.amount * 100) : Math.round(Number(amount) * 100) || 0;

  // Who
  const [query, setQuery] = useState("");
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [parent, setParent] = useState({ first_name: first0, last_name: last0, phone: "", email: "" });
  const family = options.families.find((f) => f.id === familyId) ?? null;
  const samePhone =
    digits(parent.phone).length >= 10
      ? options.families.find((f) => digits(f.phone ?? "") === digits(parent.phone))
      : undefined;

  // Which child, where
  const [childId, setChildId] = useState<string>(NEW);
  const [child, setChild] = useState({ first_name: "", last_name: "", grade: "" });
  const [schoolId, setSchoolId] = useState<string>("");
  const [schoolName, setSchoolName] = useState("");
  const [programId, setProgramId] = useState<string>("");
  const [program, setProgram] = useState({ name: "", monthly_fee: "" });
  const [placing, setPlacing] = useState(false);
  // One per payment: a second tap on "Record" sends the same key and records nothing more.
  const [key, setKey] = useState(newClientKey);

  const school = options.schools.find((s) => s.id === schoolId);
  /** A new program's fee starts at what was paid: usually one month's fee. */
  function chooseProgram(id: string) {
    setProgramId(id);
    if (id === NEW && !program.monthly_fee && cents > 0) {
      setProgram((p) => ({ ...p, monthly_fee: (cents / 100).toFixed(2) }));
    }
  }
  const chosenProgram = school?.programs.find((p) => p.id === programId);
  const knownChild = family?.children.find((c) => c.id === childId);

  const list = useMemo(() => {
    const q = norm(query.trim());
    const qd = digits(query);
    if (q) {
      return options.families.filter(
        (f) =>
          norm(`${f.name} ${f.children.map((c) => `${c.first_name} ${c.last_name}`).join(" ")}`).includes(q) ||
          (qd.length >= 3 && digits(f.phone ?? "").includes(qd))
      );
    }
    if (!zelle) return options.families.slice(0, 8);
    return [...options.families]
      .map((f) => ({ f, score: likeness(f, zelle.sender) }))
      .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name))
      .slice(0, 8)
      .map((x) => x.f);
  }, [query, options.families, zelle]);

  function reset() {
    setStep("who");
    setHistory([]);
    setQuery("");
    setFamilyId(null);
    setChildId(NEW);
    setChild({ first_name: "", last_name: "", grade: "" });
    setSchoolId("");
    setSchoolName("");
    setProgramId("");
    setProgram({ name: "", monthly_fee: "" });
    setPlacing(false);
    setKey(newClientKey());
  }

  function pickFamily(f: AssignFamily) {
    setFamilyId(f.id);
    setChildId(f.children[0]?.id ?? NEW);
    setChild((c) => ({ ...c, last_name: f.name.split(" ").slice(1).join(" ") }));
    if (f.owedCents > 0) {
      setPlacing(false);
      go("review");
    } else {
      setPlacing(true);
      go("child");
    }
  }

  // What will be created, for the review and for the action
  const newChild = !family || childId === NEW;
  const newSchool = placing && schoolId === NEW;
  const newProgram = placing && programId === NEW;
  const fee = newProgram ? Number(program.monthly_fee) || 0 : chosenProgram?.monthly_fee ?? 0;
  const childName = newChild ? child.first_name.trim() : knownChild?.first_name ?? "";
  const parentName = family ? family.name : `${parent.first_name} ${parent.last_name}`.trim();
  const programLabel = newProgram ? program.name.trim() : chosenProgram?.name ?? "";
  const schoolLabel = newSchool ? schoolName.trim() : school?.name ?? "";
  const owedAfterPlacing = (family?.owedCents ?? 0) + (placing ? Math.round(fee * 100) : 0);
  const leftover = cents - owedAfterPlacing;

  const childReady = newChild ? !!child.first_name.trim() : !!knownChild;
  const whereReady =
    (schoolId === NEW ? !!schoolName.trim() : !!schoolId) &&
    (programId === NEW ? !!program.name.trim() && Number(program.monthly_fee) > 0 : !!programId);
  const newFamilyReady = !!parent.first_name.trim() && digits(parent.phone).length >= 10 && !samePhone;
  const moneyReady = cents > 0;

  function input(): AssignInput {
    return {
      source: zelle
        ? { kind: "zelle", receiptId: zelle.receiptId }
        : { kind: "manual", amount: cents / 100, method },
      parent: family ? { id: family.id } : parent,
      placement: placing
        ? {
            student: newChild ? child : { id: childId },
            school: programId === NEW ? (schoolId === NEW ? { name: schoolName } : { id: schoolId }) : undefined,
            program:
              programId === NEW
                ? { name: program.name, monthly_fee: Number(program.monthly_fee) }
                : { id: programId },
          }
        : undefined,
      key,
    };
  }

  async function submit() {
    const ok = await run(() => assignUnrecognisedPayment(input()), {
      success: `${formatCurrency(cents / 100)} recorded for ${parentName}`,
      error: "The payment wasn't recorded",
    });
    if (ok) {
      onOpenChange(false);
      reset();
    }
  }

  const title: Record<Step, string> = {
    who: "Who paid this?",
    "new-family": "Someone new",
    child: "Which child is it for?",
    where: `Where does ${childName || "the child"} play?`,
    review: "Check, then record",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl" data-testid="assign-payment">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step !== "who" && (
              <button
                type="button"
                onClick={back}
                aria-label="Back"
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <DialogTitle>{title[step]}</DialogTitle>
          </div>
        </DialogHeader>

        {/* The money, always in view */}
        {zelle ? (
          <div className="mb-4 rounded-xl bg-violet-50 px-4 py-3 text-violet-950">
            <p className="text-lg font-semibold">
              {formatCurrency(zelle.amount)} <span className="font-normal">by Zelle from</span> {zelle.sender}
            </p>
            {zelle.memo && <p className="text-sm">&ldquo;{zelle.memo}&rdquo;</p>}
          </div>
        ) : step === "who" ? (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="assign-amount">Amount paid</Label>
              <Input
                id="assign-amount"
                inputMode="decimal"
                placeholder="120.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </div>
            <div>
              <Label htmlFor="assign-method">How</Label>
              <Select
                id="assign-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "zelle", label: "Zelle" },
                  { value: "venmo", label: "Venmo" },
                ]}
              />
            </div>
          </div>
        ) : (
          <p className="mb-4 rounded-xl bg-muted px-4 py-2 font-semibold">
            {formatCurrency(cents / 100)} by {method}
          </p>
        )}

        {step === "who" && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search families"
                className="h-11 pl-9"
                placeholder="Parent, child or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {!query && zelle && list.length > 0 && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Closest to {zelle.sender}</p>
            )}
            <ul className="divide-y rounded-xl border">
              {list.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!moneyReady}
                    onClick={() => pickFamily(f)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{f.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {f.children.length ? f.children.map((c) => c.first_name).join(", ") : "No children yet"}
                        {" · "}
                        {f.owedCents > 0 ? `owes ${formatCurrency(f.owedCents / 100)}` : "nothing owed"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No family matches.</li>}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={!moneyReady}
              onClick={() => {
                setFamilyId(null);
                setPlacing(true);
                setChildId(NEW);
                setChild((c) => ({ ...c, last_name: c.last_name || parent.last_name }));
                go("new-family");
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" /> Someone new
            </Button>
            {!moneyReady && <p className="text-sm text-amber-700">Enter the amount first.</p>}
          </div>
        )}

        {step === "new-family" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="parent-first">Parent first name</Label>
                <Input id="parent-first" value={parent.first_name} onChange={(e) => setParent({ ...parent, first_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="parent-last">Last name</Label>
                <Input id="parent-last" value={parent.last_name} onChange={(e) => setParent({ ...parent, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="parent-phone">Phone (for WhatsApp)</Label>
              <Input
                id="parent-phone"
                type="tel"
                inputMode="tel"
                placeholder="(214) 555-0101"
                value={parent.phone}
                onChange={(e) => setParent({ ...parent, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="parent-email">Email (optional, for receipts)</Label>
              <Input id="parent-email" type="email" value={parent.email} onChange={(e) => setParent({ ...parent, email: e.target.value })} />
            </div>
            {samePhone && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                That&rsquo;s <strong>{samePhone.name}</strong>&rsquo;s number already.
                <Button type="button" size="sm" className="ml-2" onClick={() => pickFamily(samePhone)}>
                  Use {samePhone.name.split(" ")[0]}&rsquo;s family
                </Button>
              </div>
            )}
            <Button
              type="button"
              className="h-11 w-full"
              disabled={!newFamilyReady}
              onClick={() => {
                setChild((c) => ({ ...c, last_name: c.last_name || parent.last_name }));
                go("child");
              }}
            >
              Next: their child
            </Button>
          </div>
        )}

        {step === "child" && (
          <div className="space-y-3">
            {family && family.children.length > 0 && (
              <div className="space-y-2" role="radiogroup" aria-label="Child">
                {family.children.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3">
                    <input type="radio" name="child" checked={childId === c.id} onChange={() => setChildId(c.id)} className="h-4 w-4" />
                    <span>
                      <span className="font-medium">{c.first_name} {c.last_name}</span>
                      {c.programs.length > 0 && (
                        <span className="block text-sm text-muted-foreground">{c.programs.map((p) => p.name).join(", ")}</span>
                      )}
                    </span>
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3">
                  <input type="radio" name="child" checked={childId === NEW} onChange={() => setChildId(NEW)} className="h-4 w-4" />
                  <span className="font-medium">A child not listed</span>
                </label>
              </div>
            )}
            {childId === NEW && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="child-first">Child first name</Label>
                  <Input id="child-first" value={child.first_name} onChange={(e) => setChild({ ...child, first_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="child-last">Last name</Label>
                  <Input id="child-last" value={child.last_name} onChange={(e) => setChild({ ...child, last_name: e.target.value })} />
                </div>
              </div>
            )}
            <Button
              type="button"
              className="h-11 w-full"
              disabled={!childReady}
              onClick={() => {
                // A child already in one program most likely pays for that one.
                const only = knownChild?.programs.length === 1 ? knownChild.programs[0] : null;
                const home = only && options.schools.find((s) => s.programs.some((p) => p.id === only.id));
                if (home && !schoolId) {
                  setSchoolId(home.id);
                  setProgramId(only!.id);
                }
                go("where");
              }}
            >
              Next: school and program
            </Button>
          </div>
        )}

        {step === "where" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="assign-school">School</Label>
              <Select
                id="assign-school"
                value={schoolId}
                onChange={(e) => {
                  setSchoolId(e.target.value);
                  chooseProgram(e.target.value === NEW ? NEW : "");
                }}
                options={[
                  { value: "", label: "Pick a school" },
                  ...options.schools.map((s) => ({ value: s.id, label: s.name })),
                  { value: NEW, label: "+ A new school" },
                ]}
              />
            </div>
            {schoolId === NEW && (
              <div>
                <Label htmlFor="new-school">New school&rsquo;s name</Label>
                <Input id="new-school" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
              </div>
            )}
            {schoolId && (
              <div>
                <Label htmlFor="assign-program">Program</Label>
                <Select
                  id="assign-program"
                  value={programId}
                  onChange={(e) => chooseProgram(e.target.value)}
                  options={[
                    ...(schoolId === NEW ? [] : [{ value: "", label: "Pick a program" }]),
                    ...(school?.programs ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${formatCurrency(p.monthly_fee)}/mo` })),
                    { value: NEW, label: "+ A new program" },
                  ]}
                />
              </div>
            )}
            {programId === NEW && (
              <div className="grid grid-cols-[1fr_8rem] gap-3">
                <div>
                  <Label htmlFor="new-program">New program&rsquo;s name</Label>
                  <Input id="new-program" placeholder="Fall Basketball" value={program.name} onChange={(e) => setProgram({ ...program, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="new-fee">Monthly fee</Label>
                  <Input
                    id="new-fee"
                    inputMode="decimal"
                    value={program.monthly_fee}
                    onChange={(e) => setProgram({ ...program, monthly_fee: e.target.value.replace(/[^\d.]/g, "") })}
                  />
                </div>
              </div>
            )}
            <Button type="button" className="h-11 w-full" disabled={!whereReady} onClick={() => go("review")}>
              Next: check it over
            </Button>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <ul className="space-y-2" data-testid="assign-review">
              {!family && (
                <Line>
                  New family: <strong>{parentName}</strong>, {parent.phone}
                </Line>
              )}
              {family && <Line>From <strong>{family.name}</strong></Line>}
              {placing && newSchool && <Line>New school: <strong>{schoolLabel}</strong></Line>}
              {placing && newProgram && (
                <Line>
                  New program at {schoolLabel}: <strong>{programLabel}</strong>, {formatCurrency(fee)} a month
                </Line>
              )}
              {placing && (
                <Line>
                  {newChild ? "Add " : ""}
                  <strong>{childName}</strong> {newChild ? "to" : "in"} <strong>{programLabel}</strong>
                  {!newSchool && schoolLabel ? ` at ${schoolLabel}` : ""}, billed {formatCurrency(fee)} for this month
                </Line>
              )}
              <Line>
                Record <strong>{formatCurrency(cents / 100)}</strong>
                {leftover === 0
                  ? " — paid in full"
                  : leftover > 0
                    ? ` — paid in full, and ${formatCurrency(leftover / 100)} more than owed (noted, not applied)`
                    : ` — ${formatCurrency(-leftover / 100)} still to pay`}
              </Line>
              {zelle && <Line>Remember {zelle.sender} as {parentName}, so their next payment records itself</Line>}
            </ul>
            {!placing && family && (
              <button
                type="button"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setPlacing(true);
                  go("child");
                }}
              >
                It&rsquo;s for a different child or program
              </button>
            )}
            <Button type="button" className="h-12 w-full text-base" disabled={pending} onClick={submit}>
              {pending ? "Recording…" : `Record ${formatCurrency(cents / 100)}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      <span>{children}</span>
    </li>
  );
}
