"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createParent, updateParent } from "@/lib/actions/students";
import { toast } from "sonner";
import type { Parent } from "@/types/database";

interface ParentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent?: Parent;
}

export function ParentFormDialog({ open, onOpenChange, parent }: ParentFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>(parent?.preferred_payment || "cash");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      if (parent) {
        await updateParent(parent.id, formData);
        toast.success("Parent updated");
      } else {
        await createParent(formData);
        toast.success("Parent added");
      }
      onOpenChange(false);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{parent ? "Edit Parent" : "Add Parent"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input id="first_name" name="first_name" required defaultValue={parent?.first_name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input id="last_name" name="last_name" required defaultValue={parent?.last_name} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <Input id="phone" name="phone" type="tel" required defaultValue={parent?.phone} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={parent?.email || ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferred_payment">Preferred Payment</Label>
            <Select
              id="preferred_payment"
              name="preferred_payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              options={[
                { value: "cash", label: "Cash" },
                { value: "zelle", label: "Zelle" },
                { value: "venmo", label: "Venmo" },
              ]}
            />
          </div>
          {paymentMethod === "venmo" && (
            <div className="space-y-2">
              <Label htmlFor="venmo_handle">Venmo Handle</Label>
              <Input id="venmo_handle" name="venmo_handle" placeholder="@username" defaultValue={parent?.venmo_handle || ""} />
            </div>
          )}
          {paymentMethod === "zelle" && (
            <div className="space-y-2">
              <Label htmlFor="zelle_identifier">Zelle Email/Phone</Label>
              <Input id="zelle_identifier" name="zelle_identifier" defaultValue={parent?.zelle_identifier || ""} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={parent?.notes || ""} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : parent ? "Update" : "Add Parent"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
