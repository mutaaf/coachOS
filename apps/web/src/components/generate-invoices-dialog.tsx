"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { toast } from "sonner";

interface GenerateInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateInvoicesDialog({ open, onOpenChange }: GenerateInvoicesDialogProps) {
  const [loading, setLoading] = useState(false);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const month = formData.get("month") as string;
      const result = await generateMonthlyInvoices(month);
      toast.success(`${result.count} invoice(s) generated`);
      onOpenChange(false);
    } catch {
      toast.error("Failed to generate invoices");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Generate Monthly Invoices</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            This will create invoices for all active enrollments that don&apos;t already have one for the selected month.
          </p>
          <div className="space-y-2">
            <Label htmlFor="month">Month</Label>
            <Input id="month" name="month" type="month" defaultValue={defaultMonth} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Generating..." : "Generate Invoices"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
