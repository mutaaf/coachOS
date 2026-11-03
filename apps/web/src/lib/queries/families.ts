import { createAdminSupabase } from "@/lib/supabase/server";
import { invoiceBalanceCents, toCents } from "@/lib/invoice-status";
import type { Invoice, Parent, RegistrationConsents, Student } from "@/types/database";
import { logMedicalView } from "@/lib/audit";

/**
 * A family, as a parent asks about it on WhatsApp: "what do we owe?"
 *
 * A family is every child linked to this parent, and every parent linked to
 * those children. Money owed counts each child's invoices whichever parent was
 * billed — either may be the one who pays, as with openInvoicesForFamily.
 *
 * Owed leaves out a bank payment still settling: that money is on its way and
 * asking for it again would chase them twice. It is shown on its own.
 */

export type FamilyChild = Pick<
  Student,
  "id" | "first_name" | "last_name" | "grade" | "status" | "medical_notes" | "photo_release" | "photo_release_at"
> & {
  relationship: string;
  enrollments: { id: string; status: string; programName: string; schoolName: string }[];
  /** What was agreed on the child's most recent website registration, as sent. */
  consents: RegistrationConsents | null;
};

export type FamilyInvoice = Pick<Invoice, "id" | "month" | "due_date" | "status" | "amount" | "student_id" | "parent_id"> & {
  studentName: string;
  programName: string;
  balanceCents: number;
};

export type FamilyMessage = {
  id: string;
  message: string;
  status: string;
  recipient_name: string | null;
  created_at: string;
};

export type Family = {
  parent: Parent;
  guardians: (Parent & { relationship: string })[];
  children: FamilyChild[];
  invoices: FamilyInvoice[];
  owedCents: number;
  processingCents: number;
  creditCents: number;
  messages: FamilyMessage[];
};

const name = (p: { first_name: string; last_name: string | null } | null | undefined) =>
  p ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "";

export async function getFamily(parentId: string): Promise<Family | null> {
  const supabase = createAdminSupabase();

  const { data: parent } = await supabase.from("parents").select("*").eq("id", parentId).maybeSingle();
  if (!parent) return null;

  const { data: childLinks } = await supabase
    .from("student_parents")
    .select("relationship, students(id, first_name, last_name, grade, status, medical_notes, photo_release, photo_release_at)")
    .eq("parent_id", parentId);
  const kids = ((childLinks || []) as any[]).filter((l) => l.students);
  const studentIds = kids.map((l) => l.students.id as string);

  const [guardianLinks, enrollments, invoices, credits, registrations] = await Promise.all([
    studentIds.length
      ? supabase.from("student_parents").select("parent_id, relationship, parents(*)").in("student_id", studentIds)
      : Promise.resolve({ data: [] as any[] }),
    studentIds.length
      ? supabase
          .from("enrollments")
          .select("id, student_id, status, programs(name, schools(name))")
          .in("student_id", studentIds)
          .order("enrolled_at")
      : Promise.resolve({ data: [] as any[] }),
    studentIds.length
      ? supabase
          .from("invoices")
          .select(
            "id, month, due_date, status, amount, student_id, parent_id, students(first_name, last_name), programs(name), payments(amount)"
          )
          .in("student_id", studentIds)
          .order("month", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("family_credits").select("amount").eq("parent_id", parentId),
    studentIds.length
      ? supabase
          .from("registrations")
          .select("student_id, consents, created_at")
          .in("student_id", studentIds)
          .not("consents", "is", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const latestConsents = new Map<string, RegistrationConsents>();
  for (const r of (registrations.data || []) as any[]) {
    if (!latestConsents.has(r.student_id)) latestConsents.set(r.student_id, r.consents);
  }

  // Each guardian once, this parent first. Their relationship is the one they
  // have to the first child that names one.
  const guardians = new Map<string, Parent & { relationship: string }>();
  guardians.set(parent.id, { ...parent, relationship: kids[0]?.relationship ?? "parent" });
  for (const link of (guardianLinks.data || []) as any[]) {
    if (link.parents && !guardians.has(link.parent_id)) {
      guardians.set(link.parent_id, { ...link.parents, relationship: link.relationship });
    }
  }

  // Messages to anyone raising these children: either parent may be the one she wrote to.
  const { data: messages } = await supabase
    .from("message_queue")
    .select("id, message, status, recipient_name, created_at")
    .in("parent_id", [...guardians.keys()])
    .order("created_at", { ascending: false })
    .limit(30);

  const children: FamilyChild[] = kids
    .map((l) => ({
      ...l.students,
      relationship: l.relationship,
      consents: latestConsents.get(l.students.id) ?? null,
      enrollments: ((enrollments.data || []) as any[])
        .filter((e) => e.student_id === l.students.id)
        .map((e) => ({
          id: e.id,
          status: e.status,
          programName: e.programs?.name ?? "",
          schoolName: e.programs?.schools?.name ?? "",
        })),
    }))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));

  // This page shows each child's medical note.
  await logMedicalView(supabase, "family_page", children);

  const familyInvoices: FamilyInvoice[] = ((invoices.data || []) as any[]).map((inv) => ({
    id: inv.id,
    month: inv.month,
    due_date: inv.due_date,
    status: inv.status,
    amount: Number(inv.amount),
    student_id: inv.student_id,
    parent_id: inv.parent_id,
    studentName: name(inv.students),
    programName: inv.programs?.name ?? "",
    balanceCents: invoiceBalanceCents(inv),
  }));

  const sum = (status: (s: string) => boolean) =>
    familyInvoices.filter((i) => status(i.status)).reduce((s, i) => s + i.balanceCents, 0);

  return {
    parent,
    guardians: [...guardians.values()],
    children,
    invoices: familyInvoices,
    owedCents: sum((s) => s !== "processing"),
    processingCents: sum((s) => s === "processing"),
    creditCents: Math.max(0, (credits.data || []).reduce((s, r: any) => s + toCents(r.amount), 0)),
    messages: (messages || []) as FamilyMessage[],
  };
}

/** For the Parents list: what each family owes, and the credit they have on file. */
export async function getFamilyBalances(): Promise<Record<string, { owedCents: number; creditCents: number }>> {
  const supabase = createAdminSupabase();
  const [links, invoices, credits] = await Promise.all([
    supabase.from("student_parents").select("student_id, parent_id"),
    supabase
      .from("invoices")
      .select("student_id, amount, status, payments(amount)")
      .in("status", ["pending", "overdue"]),
    supabase.from("family_credits").select("parent_id, amount"),
  ]);

  const owedByStudent = new Map<string, number>();
  for (const inv of (invoices.data || []) as any[]) {
    owedByStudent.set(inv.student_id, (owedByStudent.get(inv.student_id) ?? 0) + invoiceBalanceCents(inv));
  }

  const out: Record<string, { owedCents: number; creditCents: number }> = {};
  const entry = (id: string) => (out[id] ??= { owedCents: 0, creditCents: 0 });
  for (const link of links.data || []) {
    const owed = owedByStudent.get(link.student_id);
    if (owed) entry(link.parent_id).owedCents += owed;
  }
  for (const c of credits.data || []) entry(c.parent_id).creditCents += toCents(c.amount);
  for (const e of Object.values(out)) e.creditCents = Math.max(0, e.creditCents);
  return out;
}
