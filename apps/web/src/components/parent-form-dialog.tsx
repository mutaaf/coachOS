"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createParent, updateParent } from "@/lib/actions/students";
import { useAction } from "@/lib/use-action";
import type { Parent } from "@/types/database";
import type { ParentOnFile } from "@/lib/identity";
import { SamePersonPrompt, parentMatches } from "@/components/same-person-prompt";
import { toast } from "sonner";

interface ParentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent?: Parent;
}

export function ParentFormDialog({ open, onOpenChange, parent }: ParentFormDialogProps) {
  const { run, pending } = useAction();
  const [paymentMethod, setPaymentMethod] = useState<string>(parent?.preferred_payment || "cash");
  const [asking, setAsking] = useState<{ formData: FormData; matches: ParentOnFile[] } | null>(null);

  // The dialog stays mounted, empty, until a parent is chosen, so state set
  // only on mount opened every edit on "Cash" with no Zelle field — and saving
  // a new phone number switched a Zelle family to cash. Set it on each opening.
  useEffect(() => {
    if (open) setPaymentMethod(parent?.preferred_payment || "cash");
    if (!open) setAsking(null);
  }, [open, parent]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    // These report failure by returning an error, so the old try/catch never
    // fired and a parent that failed to save still said "Parent added".
    if (parent) {
      const ok = await run(() => updateParent(parent.id, formData), {
        success: "Parent updated",
        error: "The parent wasn't updated",
      });
      if (ok) onOpenChange(false);
      return;
    }
    await add(formData);
  }

  async function add(formData: FormData) {
    // That phone number already on file: ask before adding a second parent.
    const found: { matches?: ParentOnFile[] } = {};
    const ok = await run(
      async () => {
        const result = await createParent(formData);
        if ("matches" in result && result.matches) {
          found.matches = result.matches;
          return;
        }
        return result;
      },
      { error: "The parent wasn't added" }
    );
    if (found.matches) {
      setAsking({ formData, matches: found.matches });
      return;
    }
    if (ok) {
      toast.success("Parent added");
      onOpenChange(false);
    }
  }

  function keepOnFile(id: string) {
    const match = asking?.matches.find((m) => m.id === id);
    toast.success(match ? `${match.first_name} ${match.last_name} is already on file — nothing added` : "Already on file");
    onOpenChange(false);
  }

  function addAnyway() {
    if (!asking) return;
    const formData = new FormData();
    asking.formData.forEach((v, k) => formData.set(k, v));
    formData.set("confirm_new", "1");
    void add(formData);
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
                { value: "stripe", label: "Stripe" },
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
          {asking && (
            <SamePersonPrompt
              question="Is this the same parent?"
              matches={parentMatches(asking.matches)}
              sameLabel="Yes, keep this one"
              newLabel="No, add a new parent"
              onSame={keepOnFile}
              onNew={addAnyway}
              onBack={() => setAsking(null)}
              disabled={pending}
            />
          )}
          <div className={asking ? "hidden" : "flex justify-end gap-3 pt-2"}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : parent ? "Update" : "Add Parent"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
