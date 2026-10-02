"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reportProblem } from "@/lib/actions/report";

/**
 * "Something's wrong" in her own words, from wherever she is. The page and
 * version go with it, so she doesn't have to explain where.
 */
export function ReportProblemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const pathname = usePathname();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await reportProblem(text, pathname);
      if ("error" in res && res.error) {
        toast.error("Not sent", { description: res.error });
        return;
      }
      toast.success("Thanks — sent", {
        description: "You'll see it marked fixed in Help → What's new once it's sorted.",
      });
      setText("");
      onOpenChange(false);
    } catch (e) {
      toast.error("Not sent", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="report-problem">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="report-text">What happened, and what did you expect?</Label>
            <Textarea
              id="report-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="I tapped Record and it said… I expected…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The page you&rsquo;re on is sent with it. Families&rsquo; names, phone numbers and emails are removed before
            it goes to the people fixing it.
          </p>
          <Button className="h-11 w-full" disabled={!text.trim() || sending} onClick={send}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
