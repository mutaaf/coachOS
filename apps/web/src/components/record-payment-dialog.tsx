"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordPayment, updatePayment, fetchPendingInvoices, fetchInvoiceDetail } from "@/lib/actions/payments";
import { formatCurrency } from "@/lib/utils";
import { useAction } from "@/lib/use-action";
import { useRouter } from "next/navigation";

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId?: string | null;
  payment?: any;
}

export function RecordPaymentDialog({ open, onOpenChange, invoiceId, payment }: RecordPaymentDialogProps) {
  const router = useRouter();
  const isEditing = !!payment;
  const { run, pending } = useAction();
  const [method, setMethod] = useState(payment?.method || "cash");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState(invoiceId || "");
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);

  useEffect(() => {
    if (isEditing) {
      setMethod(payment.method || "cash");
      return;
    }
    if (open && !invoiceId) {
      fetchPendingInvoices().then((data) => setInvoices(data));
    }
    if (invoiceId) setSelectedInvoice(invoiceId);
  }, [open, invoiceId, isEditing, payment]);

  useEffect(() => {
    if (isEditing) return;
    if (selectedInvoice && open) {
      fetchInvoiceDetail(selectedInvoice).then((data) => setInvoiceDetail(data));
    }
  }, [selectedInvoice, open, isEditing]);

  const totalPaid = invoiceDetail?.payments?.reduce((s: number, p: any) => s + Number(p.amount), 0) || 0;
  const remaining = invoiceDetail ? Number(invoiceDetail.amount) - totalPaid : 0;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    // Recording a payment used to ignore what the action returned, so a payment
    // that failed to save still said "Payment recorded" and closed the dialog —
    // money marked as received that the books never saw.
    const ok = isEditing
      ? await run(() => updatePayment(payment.id, formData), {
          success: "Payment updated",
          error: "The payment wasn't updated",
        })
      : await run(
          () => {
            formData.set("invoice_id", selectedInvoice);
            return recordPayment(formData);
          },
          { success: "Payment recorded", error: "The payment wasn't recorded" }
        );

    if (ok) onOpenChange(false);
  }

  const placeholders: Record<string, string> = {
    cash: "Receipt #",
    zelle: "Zelle transaction ID",
    venmo: "@handle or transaction ID",
    stripe: "Stripe payment ID",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Payment" : "Record Payment"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {!isEditing && !invoiceId && (
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

          {!isEditing && invoiceDetail && (
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
              defaultValue={isEditing ? payment.amount : remaining > 0 ? remaining : ""}
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
                { value: "stripe", label: "Stripe" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" placeholder={placeholders[method]} defaultValue={isEditing ? payment.reference || "" : ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={isEditing ? payment.notes || "" : ""} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || (!isEditing && !selectedInvoice)}>
              {pending ? (isEditing ? "Saving..." : "Recording...") : (isEditing ? "Save Changes" : "Record Payment")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
