"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ZelleSetupSteps } from "@/components/zelle-setup";
import { formatCurrency } from "@/lib/utils";
import { useAction } from "@/lib/use-action";
import { inviteFamiliesToAutopay } from "@/lib/actions/autopay";
import { ignoreZelleReceipt, matchZelleReceipt, undoZelleMatch } from "@/lib/actions/zelle";
import { Repeat, Inbox, Mail, Undo2 } from "lucide-react";

export interface CollectPanelProps {
  autopay: {
    activeCount: number;
    stripeEnabled: boolean;
    zelleSecret: string;
    zelleRecipient: string;
    zelleInbox: string;
    zelleForwardFrom: string;
  };
  inviteCount: number;
  zelle: { needsLook: any[]; recent: any[]; connected: boolean };
  parents: { id: string; label: string }[];
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ZelleSetupDialog({
  open,
  onOpenChange,
  secret,
  inbox,
  forwardFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string;
  inbox: string;
  forwardFrom: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Record Zelle payments automatically</DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          <ZelleSetupSteps secret={secret} inbox={inbox} forwardFrom={forwardFrom} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NeedsLookRow({ receipt, parents }: { receipt: any; parents: { id: string; label: string }[] }) {
  const { run, pending } = useAction();
  const [parentId, setParentId] = useState<string>(receipt.parent_id ?? "");
  const unreadable = receipt.status === "unreadable";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">
          {unreadable ? receipt.subject || "An email we couldn't read" : receipt.sender_name}
          {!unreadable && (
            <span className="ml-2 font-semibold text-green-700">{formatCurrency(receipt.amount)}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{when(receipt.received_at)}</p>
      </div>
      {receipt.memo && <p className="text-sm text-muted-foreground">&ldquo;{receipt.memo}&rdquo;</p>}
      {receipt.note && <p className="mt-0.5 text-sm text-amber-700">{receipt.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!unreadable && (
          <>
            <Select
              aria-label={`Family for ${receipt.sender_name}`}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              options={[{ value: "", label: "Who sent this?" }, ...parents.map((p) => ({ value: p.id, label: p.label }))]}
            />
            <Button
              size="sm"
              disabled={!parentId || pending}
              onClick={() =>
                run(() => matchZelleReceipt(receipt.id, parentId), {
                  success: "Payment recorded",
                  error: "The payment wasn't recorded",
                })
              }
            >
              Record
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={pending}
          onClick={() =>
            run(() => ignoreZelleReceipt(receipt.id), { error: "That didn't dismiss" })
          }
        >
          {unreadable ? "Dismiss" : "Not a family"}
        </Button>
      </div>
    </li>
  );
}

export function PaymentsCollectPanel({ autopay, inviteCount, zelle, parents }: CollectPanelProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [showSetup, setShowSetup] = useState(false);

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {/* Autopay */}
      <section data-tour="autopay" className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
            <Repeat className="h-4 w-4 text-emerald-700" />
          </div>
          <h2 className="font-semibold">Autopay</h2>
        </div>
        {autopay.stripeEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{autopay.activeCount}</span>{" "}
              {autopay.activeCount === 1 ? "family pays" : "families pay"} automatically.
              {inviteCount > 0 &&
                ` ${inviteCount} ${inviteCount === 1 ? "family hasn't" : "haven't"} been set up yet.`}
            </p>
            {inviteCount > 0 && (
              <Button
                size="sm"
                className="mt-3"
                disabled={pending}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Prepare a personal payment link message for ${inviteCount} ${inviteCount === 1 ? "family" : "families"}? You'll send them from the Outbox.`
                    )
                  )
                    return;
                  const ok = await run(() => inviteFamiliesToAutopay(), {
                    success: `${inviteCount} ${inviteCount === 1 ? "message is" : "messages are"} ready to send`,
                    error: "The links weren't prepared",
                    refresh: false,
                  });
                  if (ok) router.push("/messaging?tab=outbox");
                }}
              >
                Send {inviteCount} payment {inviteCount === 1 ? "link" : "links"}
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Turn on Stripe in Settings to let families pay automatically by bank or card.
          </p>
        )}
        {!autopay.zelleRecipient && (
          <p className="mt-3 text-xs text-amber-700">
            Add your Zelle number in Settings so families see it on their payment page.
          </p>
        )}
      </section>

      {/* Zelle inbox */}
      <section data-tour="zelle" className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
              <Inbox className="h-4 w-4 text-violet-700" />
            </div>
            <h2 className="font-semibold">
              Zelle
              {zelle.needsLook.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {zelle.needsLook.length} to check
                </span>
              )}
            </h2>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setShowSetup(true)}>
            <Mail className="mr-1 h-4 w-4" /> {zelle.connected ? "Setup" : "Connect Gmail"}
          </Button>
        </div>

        {!zelle.connected ? (
          <p className="text-sm text-muted-foreground">
            Connect the Gmail your bank emails, and Zelle payments are recorded as they arrive —
            no more matching &ldquo;sent it via zelle&rdquo; messages by hand.
          </p>
        ) : zelle.needsLook.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to check. Payments are being matched automatically.
          </p>
        ) : (
          <ul className="divide-y">
            {zelle.needsLook.map((r) => (
              <NeedsLookRow key={r.id} receipt={r} parents={parents} />
            ))}
          </ul>
        )}

        {zelle.recent.length > 0 && (
          <details className="mt-3 border-t pt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Recently recorded ({zelle.recent.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {zelle.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {when(r.received_at)} · {r.sender_name}{" "}
                    <span className="font-medium text-green-700">{formatCurrency(r.amount)}</span>
                    {r.parents && r.sender_name !== `${r.parents.first_name} ${r.parents.last_name}` && (
                      <span className="text-muted-foreground">
                        {" "}
                        → {r.parents.first_name} {r.parents.last_name}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    disabled={pending}
                    onClick={async () => {
                      if (!window.confirm("Remove this payment and put it back in the inbox?")) return;
                      await run(() => undoZelleMatch(r.id), {
                        success: "Moved back to the inbox",
                        error: "That didn't undo",
                      });
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                    <span className="sr-only">Undo</span>
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <ZelleSetupDialog
        open={showSetup}
        onOpenChange={setShowSetup}
        secret={autopay.zelleSecret}
        inbox={autopay.zelleInbox}
        forwardFrom={autopay.zelleForwardFrom}
      />
    </div>
  );
}
