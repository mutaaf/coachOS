"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateInvoice } from "@/lib/actions/payments";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface InvoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
}

export function InvoiceFormDialog({ open, onOpenChange, invoice }: InvoiceFormDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!invoice) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await updateInvoice(invoice.id, formData);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Invoice updated");
        onOpenChange(false);
        router.refresh();
      }
    } catch {
      toast.error("Failed to update invoice");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Edit Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
            <div><span className="text-muted-foreground">Student:</span> {invoice.students?.first_name} {invoice.students?.last_name}</div>
            <div><span className="text-muted-foreground">Parent:</span> {invoice.parents?.first_name} {invoice.parents?.last_name}</div>
            <div><span className="text-muted-foreground">Program:</span> {invoice.programs?.name}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount *</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                required
                defaultValue={invoice.amount}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select
                id="status"
                name="status"
                required
                defaultValue={invoice.status}
                options={[
                  { value: "pending", label: "Pending" },
                  { value: "paid", label: "Paid" },
                  { value: "overdue", label: "Overdue" },
                  { value: "waived", label: "Waived" },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="due_date">Due Date *</Label>
              <Input
                id="due_date"
                name="due_date"
                type="date"
                required
                defaultValue={invoice.due_date}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="month">Month *</Label>
              <Input
                id="month"
                name="month"
                type="month"
                required
                defaultValue={invoice.month}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={invoice.notes || ""} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
