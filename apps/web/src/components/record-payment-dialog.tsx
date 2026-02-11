"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordPayment } from "@/lib/actions/payments";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId?: string | null;
}

export function RecordPaymentDialog({ open, onOpenChange, invoiceId }: RecordPaymentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("cash");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState(invoiceId || "");
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);

  useEffect(() => {
    if (open && !invoiceId) {
      const supabase = createClient();
      supabase
        .from("invoices")
        .select("*, parents(*), students(*), programs(*)")
        .in("status", ["pending", "overdue"])
        .order("due_date")
        .then(({ data }) => setInvoices(data || []));
    }
    if (invoiceId) setSelectedInvoice(invoiceId);
  }, [open, invoiceId]);

  useEffect(() => {
    if (selectedInvoice && open) {
      const supabase = createClient();
      supabase
        .from("invoices")
        .select("*, parents(*), students(*), programs(*), payments(amount)")
        .eq("id", selectedInvoice)
        .single()
        .then(({ data }) => setInvoiceDetail(data));
    }
  }, [selectedInvoice, open]);

  const totalPaid = invoiceDetail?.payments?.reduce((s: number, p: any) => s + Number(p.amount), 0) || 0;
  const remaining = invoiceDetail ? Number(invoiceDetail.amount) - totalPaid : 0;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("invoice_id", selectedInvoice);
      await recordPayment(formData);
      toast.success("Payment recorded");
      onOpenChange(false);
    } catch {
      toast.error("Failed to record payment");
    } finally {
      setLoading(false);
    }
  }

  const placeholders: Record<string, string> = {
    cash: "Receipt #",
    zelle: "Zelle transaction ID",
    venmo: "@handle or transaction ID",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {!invoiceId && (
            <div className="space-y-2">
              <Label>Invoice</Label>
              <Select
                options={invoices.map((i) => ({
                  value: i.id,
                  label: `${i.students?.first_name} ${i.students?.last_name} — ${i.programs?.name} (${i.month}) — ${formatCurrency(i.amount)}`,
                }))}
                placeholder="Select an invoice"
                value={selectedInvoice}
                onChange={(e) => setSelectedInvoice(e.target.value)}
                required
              />
            </div>
          )}

          {invoiceDetail && (
            <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Student:</span> {invoiceDetail.students?.first_name} {invoiceDetail.students?.last_name}</div>
              <div><span className="text-muted-foreground">Amount Due:</span> {formatCurrency(invoiceDetail.amount)}</div>
              <div><span className="text-muted-foreground">Remaining:</span> {formatCurrency(remaining)}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              required
              defaultValue={remaining > 0 ? remaining : ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method *</Label>
            <Select
              id="method"
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={[
                { value: "cash", label: "Cash" },
                { value: "zelle", label: "Zelle" },
                { value: "venmo", label: "Venmo" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" placeholder={placeholders[method]} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !selectedInvoice}>
              {loading ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
