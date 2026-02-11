"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { GenerateInvoicesDialog } from "@/components/generate-invoices-dialog";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, AlertTriangle, CheckCircle, Clock, Plus, FileText } from "lucide-react";

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const filtered = statusFilter === "all"
    ? invoices
    : invoices.filter((i) => i.status === statusFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <div className="flex gap-2">
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
          {/* Filter Bar */}
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
                      <td className="p-4 text-right">
                        {(inv.status === "pending" || inv.status === "overdue") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setSelectedInvoiceId(inv.id); setShowRecordPayment(true); }}
                          >
                            Record Payment
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {payments.length === 0 ? (
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
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p: any) => (
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
        onOpenChange={setShowRecordPayment}
        invoiceId={selectedInvoiceId}
      />
      <GenerateInvoicesDialog open={showGenerate} onOpenChange={setShowGenerate} />
    </div>
  );
}
