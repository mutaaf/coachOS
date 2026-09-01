"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { GenerateInvoicesDialog } from "@/components/generate-invoices-dialog";
import { InvoiceFormDialog } from "@/components/invoice-form-dialog";
import { formatCurrency } from "@/lib/utils";
import { sendStripePaymentLink } from "@/lib/actions/stripe";
import { waiveInvoice, deleteInvoice, deletePayment } from "@/lib/actions/payments";
import { DollarSign, AlertTriangle, CheckCircle, Clock, Plus, FileText, ExternalLink, Send, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface PaymentSummary {
  totalRevenue: number;
  pendingAmount: number;
  overdueAmount: number;
  overdueCount: number;
  paidThisMonth: number;
}

interface PaymentsPageClientProps {
  summary: PaymentSummary;
  invoices: any[];
  payments: any[];
}

const statusBadge = (status: string) => {
  const map: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    paid: "success",
    pending: "warning",
    overdue: "destructive",
    waived: "secondary",
  };
  return <Badge variant={map[status] || "secondary"}>{status}</Badge>;
};

export function PaymentsPageClient({ summary, invoices, payments }: PaymentsPageClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("all");
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Edit state
  const [editingInvoice, setEditingInvoice] = useState<any>(null);
  const [editingPayment, setEditingPayment] = useState<any>(null);

  // Invoice tab filters
  const [studentFilter, setStudentFilter] = useState("all");
  const [parentFilter, setParentFilter] = useState("all");
  const [programFilter, setProgramFilter] = useState("all");

  // Payment history tab filters
  const [paymentStudentFilter, setPaymentStudentFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");

  // Extract unique filter options from data
  const invoiceStudents = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((i) => {
      if (i.student_id && i.students) map.set(i.student_id, `${i.students.first_name} ${i.students.last_name}`);
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [invoices]);

  const invoiceParents = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((i) => {
      if (i.parent_id && i.parents) map.set(i.parent_id, `${i.parents.first_name} ${i.parents.last_name}`);
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [invoices]);

  const invoicePrograms = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((i) => {
      if (i.program_id && i.programs) map.set(i.program_id, i.programs.name);
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [invoices]);

  const paymentStudents = useMemo(() => {
    const map = new Map<string, string>();
    payments.forEach((p) => {
      const s = p.invoices?.students;
      const sid = p.invoices?.student_id;
      if (sid && s) map.set(sid, `${s.first_name} ${s.last_name}`);
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [payments]);

  const paymentMethods = useMemo(() => {
    const set = new Set<string>();
    payments.forEach((p) => { if (p.method) set.add(p.method); });
    return Array.from(set).map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }));
  }, [payments]);

  // Filtered invoices: status + student + parent + program
  const filtered = useMemo(() => {
    return invoices.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (studentFilter !== "all" && i.student_id !== studentFilter) return false;
      if (parentFilter !== "all" && i.parent_id !== parentFilter) return false;
      if (programFilter !== "all" && i.program_id !== programFilter) return false;
      return true;
    });
  }, [invoices, statusFilter, studentFilter, parentFilter, programFilter]);

  // Filtered payments: student + method
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (paymentStudentFilter !== "all" && p.invoices?.student_id !== paymentStudentFilter) return false;
      if (paymentMethodFilter !== "all" && p.method !== paymentMethodFilter) return false;
      return true;
    });
  }, [payments, paymentStudentFilter, paymentMethodFilter]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowGenerate(true)}>
            <FileText className="h-4 w-4 mr-2" /> Generate Invoices
          </Button>
          <Button onClick={() => { setSelectedInvoiceId(null); setShowRecordPayment(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Record Payment
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-sm text-muted-foreground">Total Revenue</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-yellow-100 flex items-center justify-center">
              <Clock className="h-4 w-4 text-yellow-600" />
            </div>
            <span className="text-sm text-muted-foreground">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-600">{formatCurrency(summary.pendingAmount)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <span className="text-sm text-muted-foreground">Overdue ({summary.overdueCount})</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.overdueAmount)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-blue-600" />
            </div>
            <span className="text-sm text-muted-foreground">Paid This Month</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.paidThisMonth)}</p>
        </div>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="history">Payment History</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          {/* Status Filter Bar */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {["all", "pending", "overdue", "paid", "waived"].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>

          {/* Dropdown Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            {invoiceStudents.length > 1 && (
              <Select
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value)}
                options={[{ value: "all", label: "All Students" }, ...invoiceStudents]}
              />
            )}
            {invoiceParents.length > 1 && (
              <Select
                value={parentFilter}
                onChange={(e) => setParentFilter(e.target.value)}
                options={[{ value: "all", label: "All Parents" }, ...invoiceParents]}
              />
            )}
            {invoicePrograms.length > 1 && (
              <Select
                value={programFilter}
                onChange={(e) => setProgramFilter(e.target.value)}
                options={[{ value: "all", label: "All Programs" }, ...invoicePrograms]}
              />
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No invoices</h3>
              <p className="text-muted-foreground">Generate invoices to start tracking payments.</p>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Student</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Parent</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Program</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Month</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Link</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv: any) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4 font-medium">{inv.students?.first_name} {inv.students?.last_name}</td>
                      <td className="p-4 hidden sm:table-cell text-sm">{inv.parents?.first_name} {inv.parents?.last_name}</td>
                      <td className="p-4 hidden md:table-cell text-sm">{inv.programs?.name}</td>
                      <td className="p-4 text-sm">{inv.month}</td>
                      <td className="p-4 font-medium">{formatCurrency(inv.amount)}</td>
                      <td className="p-4">{statusBadge(inv.status)}</td>
                      <td className="p-4 hidden lg:table-cell">
                        {inv.stripe_hosted_invoice_url ? (
                          <a href={inv.stripe_hosted_invoice_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 text-blue-500" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.stripe_hosted_invoice_url && (inv.status === "pending" || inv.status === "overdue") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const result = await sendStripePaymentLink(inv.id);
                                if ("error" in result) toast.error(result.error);
                                else toast.success("Payment link sent via WhatsApp");
                              }}
                            >
                              <Send className="h-4 w-4 mr-1" /> Send Link
                            </Button>
                          )}
                          {(inv.status === "pending" || inv.status === "overdue") && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setSelectedInvoiceId(inv.id); setShowRecordPayment(true); }}
                              >
                                Record Payment
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground"
                                onClick={async () => {
                                  if (!window.confirm("Waive this invoice?")) return;
                                  await waiveInvoice(inv.id);
                                  toast.success("Invoice waived");
                                  router.refresh();
                                }}
                              >
                                Waive
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingInvoice(inv)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={async () => {
                              if (!window.confirm("Delete this invoice?")) return;
                              const result = await deleteInvoice(inv.id);
                              if ("error" in result) {
                                toast.error(result.error);
                              } else {
                                toast.success("Invoice deleted");
                                router.refresh();
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {/* Payment History Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            {paymentStudents.length > 1 && (
              <Select
                value={paymentStudentFilter}
                onChange={(e) => setPaymentStudentFilter(e.target.value)}
                options={[{ value: "all", label: "All Students" }, ...paymentStudents]}
              />
            )}
            {paymentMethods.length > 1 && (
              <Select
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value)}
                options={[{ value: "all", label: "All Methods" }, ...paymentMethods]}
              />
            )}
          </div>

          {filteredPayments.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No payments recorded</h3>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Student</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Method</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Reference</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p: any) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4 text-sm">{new Date(p.received_at).toLocaleDateString()}</td>
                      <td className="p-4 font-medium text-sm">
                        {p.invoices?.students?.first_name} {p.invoices?.students?.last_name}
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <Badge variant="outline">{p.method}</Badge>
                      </td>
                      <td className="p-4 font-medium text-green-600">{formatCurrency(p.amount)}</td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">{p.reference || "—"}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingPayment(p)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={async () => {
                              if (!window.confirm("Delete this payment?")) return;
                              const result = await deletePayment(p.id);
                              if ("error" in result) {
                                toast.error(result.error);
                              } else {
                                toast.success("Payment deleted");
                                router.refresh();
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog
        open={showRecordPayment}
        onOpenChange={(open) => { setShowRecordPayment(open); if (!open) setSelectedInvoiceId(null); }}
        invoiceId={selectedInvoiceId}
      />
      <RecordPaymentDialog
        open={!!editingPayment}
        onOpenChange={(open) => { if (!open) setEditingPayment(null); }}
        payment={editingPayment}
      />
      <InvoiceFormDialog
        open={!!editingInvoice}
        onOpenChange={(open) => { if (!open) setEditingInvoice(null); }}
        invoice={editingInvoice}
      />
      <GenerateInvoicesDialog open={showGenerate} onOpenChange={setShowGenerate} />
    </div>
  );
}
