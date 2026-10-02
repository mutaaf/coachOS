import { createAdminSupabase } from "@/lib/supabase/server";
import { toCents } from "@/lib/invoice-status";

export interface AssignFamily {
  id: string;
  name: string;
  phone: string;
  children: { id: string; first_name: string; last_name: string; programs: { id: string; name: string }[] }[];
  /** Everything the family still owes. */
  owedCents: number;
}

export interface AssignSchool {
  id: string;
  name: string;
  programs: { id: string; name: string; monthly_fee: number }[];
}

/** What "Who paid this?" offers: every family, and every school's open programs. */
export async function getAssignOptions(): Promise<{ families: AssignFamily[]; schools: AssignSchool[] }> {
  const supabase = createAdminSupabase();
  const [parents, schools, open] = await Promise.all([
    supabase
      .from("parents")
      .select(
        "id, first_name, last_name, phone, student_parents(students(id, first_name, last_name, enrollments(status, programs(id, name))))"
      )
      .order("first_name"),
    supabase
      .from("schools")
      .select("id, name, programs(id, name, monthly_fee, status)")
      .neq("status", "archived")
      .order("name"),
    supabase
      .from("invoices")
      .select("student_id, amount, payments(amount)")
      .in("status", ["pending", "overdue"]),
  ]);

  const owedByStudent = new Map<string, number>();
  for (const inv of (open.data || []) as any[]) {
    const paid = (inv.payments || []).reduce((s: number, p: any) => s + toCents(p.amount), 0);
    owedByStudent.set(inv.student_id, (owedByStudent.get(inv.student_id) ?? 0) + toCents(inv.amount) - paid);
  }

  return {
    families: ((parents.data || []) as any[]).map((p) => {
      const children = (p.student_parents || [])
        .map((sp: any) => sp.students)
        .filter(Boolean)
        .map((s: any) => ({
          id: s.id,
          first_name: s.first_name,
          last_name: s.last_name,
          programs: (s.enrollments || [])
            .filter((e: any) => e.status === "active" && e.programs)
            .map((e: any) => ({ id: e.programs.id, name: e.programs.name })),
        }));
      return {
        id: p.id,
        name: `${p.first_name} ${p.last_name}`.trim(),
        phone: p.phone,
        children,
        owedCents: children.reduce((s: number, c: any) => s + Math.max(0, owedByStudent.get(c.id) ?? 0), 0),
      };
    }),
    schools: ((schools.data || []) as any[]).map((s) => ({
      id: s.id,
      name: s.name,
      programs: (s.programs || [])
        .filter((p: any) => p.status === "active" || p.status === "upcoming")
        .map((p: any) => ({ id: p.id, name: p.name, monthly_fee: Number(p.monthly_fee) }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    })),
  };
}
