"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { AssignPaymentDialog } from "@/components/assign-payment-dialog";
import { GenerateInvoicesDialog } from "@/components/generate-invoices-dialog";
import { InvoiceFormDialog } from "@/components/invoice-form-dialog";
import { formatCurrency } from "@/lib/utils";
import { familyHref } from "@/lib/family-link";
import Link from "next/link";
import { sendStripePaymentLink } from "@/lib/actions/stripe";
import { waiveInvoice, deleteInvoice, deletePayment } from "@/lib/actions/payments";
import { resetPayLink } from "@/lib/actions/autopay";
import { DollarSign, AlertTriangle, CheckCircle, Clock, Plus, FileText, ExternalLink, Send, Pencil, Trash2, Link2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "@/lib/use-action";
import { PaymentsCollectPanel, type CollectPanelProps } from "@/components/payments-collect-panel";

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
  collect: CollectPanelProps;
  /** Families who paid ahead or paid extra: spent by the next invoice run. */
  credits: { parentId: string; name: string; cents: number }[];
  /** From the address: the dashboard's "See all" opens on overdue. */
  initialStatus?: string;
}

const statusBadge = (status: string) => {
  const map: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    paid: "success",
    pending: "warning",
    overdue: "destructive",
    waived: "secondary",
    processing: "secondary",
  };
  return <Badge variant={map[status] || "secondary"}>{status}</Badge>;
};

const STATUSES = ["all", "pending", "processing", "overdue", "paid", "waived"];

export function PaymentsPageClient({ summary, invoices, payments, collect, credits, initialStatus }: PaymentsPageClientProps) {
  const router = useRouter();
  const { run } = useAction();
  const [statusFilter, setStatusFilter] = useState(
    initialStatus && STATUSES.includes(initialStatus) ? initialStatus : "all"
  );
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recording, setRecording] = useState(false);
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

  // Row actions, shared by the table (md and up) and the cards (phones).
  const isOpen = (inv: any) => inv.status === "pending" || inv.status === "overdue";
  async function copyPayLink(inv: any) {
    await navigator.clipboard.writeText(`${window.location.origin}/pay/${inv.parents.pay_token}`);
    toast.success(`Copied ${inv.parents.first_name}'s payment link`);
  }
  async function resetFamilyLink(inv: any) {
    if (
      !window.confirm(
        `Give ${inv.parents.first_name} a new payment link? The old link stops working straight away — send them the new one.`
      )
    )
      return;
    const r = await resetPayLink(inv.parent_id);
    if ("error" in r && r.error) {
      toast.error("Link not reset", { description: r.error });
      return;
    }
    await navigator.clipboard.writeText((r as { payLink: string }).payLink).catch(() => {});
    toast.success(`New link for ${inv.parents.first_name} copied — the old one no longer works`);
    router.refresh();
  }
  async function sendLink(inv: any) {
    const result = await sendStripePaymentLink(inv.id);
    if ("error" in result) toast.error(result.error);
    else toast.success("Payment link ready in Messaging → Outbox");
  }
  async function waive(inv: any) {
    if (!window.confirm("Waive this invoice?")) return;
    await run(() => waiveInvoice(inv.id), {
      success: "Invoice waived",
      error: "The invoice wasn't waived",
    });
  }
  async function removeInvoice(inv: any) {
    if (!window.confirm("Delete this invoice?")) return;
    const result = await deleteInvoice(inv.id);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Invoice deleted");
      router.refresh();
    }
  }
  async function removePayment(p: any) {
    if (!window.confirm("Delete this payment?")) return;
    const result = await deletePayment(p.id);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Payment deleted");
      router.refresh();
    }
  }
  const recordOn = (inv: any) => {
    setSelectedInvoiceId(inv.id);
    setShowRecordPayment(true);
  };
  const filtersOn =
    statusFilter !== "all" || studentFilter !== "all" || parentFilter !== "all" || programFilter !== "all";
  const clearFilters = () => {
    setStatusFilter("all");
    setStudentFilter("all");
    setParentFilter("all");
    setProgramFilter("all");
  };

  return (
    <div>
      {/* The h1 and the header buttons share one parent: tests find the
          header's Record Payment through the h1's parent. */}
      <div className="mb-6 grid gap-x-4 gap-y-1 sm:grid-cols-[1fr_auto] sm:items-center">
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-muted-foreground sm:col-start-1 sm:row-start-2">
          Invoices, what&rsquo;s owed, and money coming in.
        </p>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:flex-row">
          <Button
            variant="outline"
            className="h-11 w-full sm:h-10 sm:w-auto"
            data-tour="generate-invoices"
            onClick={() => setShowGenerate(true)}
          >
            <FileText className="h-4 w-4 mr-2" /> Generate Invoices
          </Button>
          {/* Money from anyone: an existing family, or someone new with their
              child, school and program. Paying one particular invoice is the
              "Record Payment" on its row. */}
          <Button className="h-11 w-full sm:h-10 sm:w-auto" data-tour="record-payment" onClick={() => setRecording(true)}>
            <Plus className="h-4 w-4 mr-2" /> Record Payment
          </Button>
        </div>
      </div>

      <PaymentsCollectPanel {...collect} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-green-100 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-green-600" />
            </div>
            <span className="min-w-0 text-sm leading-tight text-muted-foreground">Total Revenue</span>
          </div>
          <p className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl text-green-600">{formatCurrency(summary.totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-yellow-100 flex items-center justify-center">
              <Clock className="h-4 w-4 text-yellow-600" />
            </div>
            <span className="min-w-0 text-sm leading-tight text-muted-foreground">Pending</span>
          </div>
          <p className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl text-yellow-600">{formatCurrency(summary.pendingAmount)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <span className="min-w-0 text-sm leading-tight text-muted-foreground">Overdue ({summary.overdueCount})</span>
          </div>
          <p className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl text-red-600">{formatCurrency(summary.overdueAmount)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-blue-100 flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-blue-600" />
            </div>
            <span className="min-w-0 text-sm leading-tight text-muted-foreground">Paid This Month</span>
          </div>
          <p className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl text-blue-600">{formatCurrency(summary.paidThisMonth)}</p>
        </div>
      </div>

      {credits.length > 0 && (
        <div className="rounded-2xl border bg-card p-4 mb-6" data-testid="family-credits">
          <h2 className="font-semibold">Credit on file</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Money families paid ahead, or paid over what they owed. It goes on their next invoice by itself.
          </p>
          <ul className="divide-y">
            {credits.map((c) => (
              <li key={c.parentId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-green-700">
                  {formatCurrency(c.cents / 100)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="invoices">
        <TabsList className="h-11 w-full sm:w-auto">
          <TabsTrigger value="invoices" className="h-9 flex-1 sm:flex-none">Invoices</TabsTrigger>
          <TabsTrigger value="history" className="h-9 flex-1 sm:flex-none">Payment History</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          {/* Status Filter Bar: scrolls sideways on phones instead of wrapping */}
          <div
            data-tour="invoice-statuses"
            className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {STATUSES.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                className="h-10 shrink-0 rounded-full px-4"
                onClick={() => setStatusFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>

          {/* Dropdown Filters */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*]:w-48">
            {invoiceStudents.length > 1 && (
              <Select
                aria-label="Filter by student"
                className="h-11 sm:h-10"
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value)}
                options={[{ value: "all", label: "All Students" }, ...invoiceStudents]}
              />
            )}
            {invoiceParents.length > 1 && (
              <Select
                aria-label="Filter by parent"
                className="h-11 sm:h-10"
                value={parentFilter}
                onChange={(e) => setParentFilter(e.target.value)}
                options={[{ value: "all", label: "All Parents" }, ...invoiceParents]}
              />
            )}
            {invoicePrograms.length > 1 && (
              <Select
                aria-label="Filter by session"
                className="h-11 sm:h-10"
                value={programFilter}
                onChange={(e) => setProgramFilter(e.target.value)}
                options={[{ value: "all", label: "All sessions" }, ...invoicePrograms]}
              />
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No invoices</h3>
              {invoices.length > 0 && filtersOn ? (
                <>
                  <p className="text-muted-foreground">None match these filters.</p>
                  <Button variant="outline" className="mt-4 h-11" onClick={clearFilters}>
                    Show every invoice
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground">Generate invoices to start tracking payments.</p>
              )}
            </div>
          ) : (
            <>
            {/* Phones: one card per invoice. The table takes over from md. */}
            <ul className="space-y-3 md:hidden" data-testid="invoice-cards">
              {filtered.map((inv: any) => (
                <li key={inv.id} className="rounded-2xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {inv.students?.first_name} {inv.students?.last_name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        <Link href={familyHref(inv.parent_id)} className="underline-offset-2 hover:underline">
                          {inv.parents?.first_name} {inv.parents?.last_name}
                        </Link>
                        {inv.programs?.name ? ` · ${inv.programs.name}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0">{statusBadge(inv.status)}</div>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-muted-foreground">
                      <span className="tabular-nums">{inv.month}</span> · {inv.balance > 0 ? "Still to pay" : "Nothing owed"}
                    </p>
                    <p className="whitespace-nowrap tabular-nums">
                      {inv.balance > 0 && <span className="text-lg font-semibold">{formatCurrency(inv.balance)}</span>}
                      <span className="ml-1.5 text-sm text-muted-foreground">
                        {inv.balance > 0 ? "of " : ""}
                        {formatCurrency(inv.amount)}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    {isOpen(inv) && (
                      <Button className="h-10 flex-1" onClick={() => recordOn(inv)}>
                        Record Payment
                      </Button>
                    )}
                    {inv.stripe_hosted_invoice_url && isOpen(inv) && (
                      <Button variant="outline" className="h-10 flex-1" onClick={() => sendLink(inv)}>
                        <Send className="h-4 w-4 mr-1" /> Send Link
                      </Button>
                    )}
                    {isOpen(inv) && (
                      <Button variant="outline" className="h-10 text-muted-foreground" onClick={() => waive(inv)}>
                        Waive
                      </Button>
                    )}
                    {inv.parents?.pay_token && (
                      <Button variant="outline" className="h-10" onClick={() => copyPayLink(inv)}>
                        <Link2 className="h-4 w-4 mr-1.5 text-blue-500" /> Copy link
                      </Button>
                    )}
                    <div className="ml-auto flex gap-2">
                      {inv.parents?.pay_token && (
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Reset payment link"
                          title="Give this family a new payment link (the old one stops working)"
                          onClick={() => resetFamilyLink(inv)}
                        >
                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                      {inv.stripe_hosted_invoice_url && (
                        <a
                          href={inv.stripe_hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Stripe invoice"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border"
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </a>
                      )}
                      <Button variant="outline" size="icon" aria-label="Edit invoice" onClick={() => setEditingInvoice(inv)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Delete invoice"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeInvoice(inv)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-2xl border bg-card overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Student</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Parent</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Session</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Month</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Balance</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground hidden lg:table-cell"><span className="whitespace-nowrap">Pay link</span></th>
                    <th className="text-right px-3 py-3 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv: any) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-3 font-medium">{inv.students?.first_name} {inv.students?.last_name}</td>
                      <td className="px-3 py-3 hidden sm:table-cell text-sm">
                        <Link href={familyHref(inv.parent_id)} className="hover:underline" title="See the whole family">
                          {inv.parents?.first_name} {inv.parents?.last_name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell text-sm">{inv.programs?.name}</td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">{inv.month}</td>
                      <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(inv.amount)}</td>
                      <td className="px-3 py-3 font-medium tabular-nums whitespace-nowrap" data-testid="invoice-balance">
                        {inv.balance > 0 ? formatCurrency(inv.balance) : "—"}
                      </td>
                      <td className="px-3 py-3">{statusBadge(inv.status)}</td>
                      <td className="px-3 py-3 hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          {inv.parents?.pay_token && (
                            <button type="button" title="Copy this family's payment page link" onClick={() => copyPayLink(inv)}>
                              <Link2 className="h-4 w-4 text-blue-500" />
                              <span className="sr-only">Copy payment link</span>
                            </button>
                          )}
                          {inv.parents?.pay_token && (
                            <button
                              type="button"
                              title="Give this family a new payment link (the old one stops working)"
                              onClick={() => resetFamilyLink(inv)}
                            >
                              <RotateCcw className="h-4 w-4 text-muted-foreground" />
                              <span className="sr-only">Reset payment link</span>
                            </button>
                          )}
                          {inv.stripe_hosted_invoice_url && (
                            <a href={inv.stripe_hosted_invoice_url} target="_blank" rel="noopener noreferrer" title="Stripe invoice">
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {inv.stripe_hosted_invoice_url && isOpen(inv) && (
                            <Button size="sm" variant="ghost" className="px-2" onClick={() => sendLink(inv)}>
                              <Send className="h-4 w-4 mr-1" /> Send Link
                            </Button>
                          )}
                          {isOpen(inv) && (
                            <>
                              <Button size="sm" variant="ghost" className="px-2" onClick={() => recordOn(inv)}>
                                Record Payment
                              </Button>
                              <Button size="sm" variant="ghost" className="px-2 text-muted-foreground" onClick={() => waive(inv)}>
                                Waive
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" className="px-2" aria-label="Edit invoice" onClick={() => setEditingInvoice(inv)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete invoice"
                            className="px-2 text-destructive hover:text-destructive"
                            onClick={() => removeInvoice(inv)}
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
            </>
          )}
        </TabsContent>

        <TabsContent value="history">
          {/* Payment History Filters */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*]:w-48">
            {paymentStudents.length > 1 && (
              <Select
                aria-label="Filter by student"
                className="h-11 sm:h-10"
                value={paymentStudentFilter}
                onChange={(e) => setPaymentStudentFilter(e.target.value)}
                options={[{ value: "all", label: "All Students" }, ...paymentStudents]}
              />
            )}
            {paymentMethods.length > 1 && (
              <Select
                aria-label="Filter by method"
                className="h-11 sm:h-10"
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
              <p className="text-muted-foreground">
                {payments.length > 0
                  ? "None match these filters."
                  : "Payments show up here as they come in. Use Record Payment for cash and anything paid by hand."}
              </p>
            </div>
          ) : (
            <>
            {/* Phones: one card per payment. The table takes over from md. */}
            <ul className="space-y-3 md:hidden" data-testid="payment-cards">
              {filteredPayments.map((p: any) => (
                <li key={p.id} className="rounded-2xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {p.invoices?.students?.first_name} {p.invoices?.students?.last_name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        <span className="tabular-nums">{new Date(p.received_at).toLocaleDateString()}</span>
                        {" · "}
                        <span className="capitalize">{p.method}</span>
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-lg font-semibold tabular-nums text-green-600">
                      {formatCurrency(p.amount)}
                    </p>
                  </div>
                  <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                    <Button variant="outline" className="h-10" onClick={() => setEditingPayment(p)}>
                      <Pencil className="h-4 w-4 mr-1.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 text-destructive hover:text-destructive"
                      onClick={() => removePayment(p)}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-2xl border bg-card overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Student</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Method</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-3 py-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Reference</th>
                    <th className="text-right px-3 py-3 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p: any) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-3 text-sm whitespace-nowrap tabular-nums">{new Date(p.received_at).toLocaleDateString()}</td>
                      <td className="px-3 py-3 font-medium text-sm">
                        {p.invoices?.students?.first_name} {p.invoices?.students?.last_name}
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        <Badge variant="outline">{p.method}</Badge>
                      </td>
                      <td className="px-3 py-3 font-medium text-green-600 tabular-nums whitespace-nowrap">{formatCurrency(p.amount)}</td>
                      <td className="px-3 py-3 text-sm text-muted-foreground hidden md:table-cell">{p.reference || "—"}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Edit payment"
                            onClick={() => setEditingPayment(p)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete payment"
                            className="text-destructive hover:text-destructive"
                            onClick={() => removePayment(p)}
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
            </>
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
      <AssignPaymentDialog open={recording} onOpenChange={setRecording} options={collect.assign} source={{ kind: "manual" }} />
    </div>
  );
}
