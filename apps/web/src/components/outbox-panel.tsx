"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markOutboxMessage, skipAllPending } from "@/lib/actions/outbox";
import { smsLink, whatsappLink } from "@/lib/outbox";
import { formatPhone } from "@/lib/utils";
import { Check, Inbox, MessageCircle, MessageSquareText, Undo2 } from "lucide-react";

interface Waiting {
  id: string;
  recipient_name: string | null;
  recipient_phone: string;
  message: string;
  created_at: string;
}

interface Done {
  id: string;
  recipient_name: string | null;
  recipient_phone: string;
  message: string;
  status: "sent" | "skipped";
  sent_via: "whatsapp" | "sms" | "bot" | null;
}

/**
 * Messages waiting to go, each one tap from WhatsApp or Messages on the
 * owner's phone with the text already written.
 *
 * Marked as sent the moment it is opened, optimistically, so the next one is
 * ready when she comes back to the browser. A mis-tap is undone from "Sent".
 */
export function OutboxPanel({ waiting, done }: { waiting: Waiting[]; done: Done[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(waiting);
  const [handled, setHandled] = useState<Done[]>(done);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => setQueue(waiting), [waiting]);
  useEffect(() => setHandled(done), [done]);

  async function mark(msg: Waiting, how: "whatsapp" | "sms" | "skipped") {
    setQueue((q) => q.filter((m) => m.id !== msg.id));
    setHandled((h) => [
      { ...msg, status: how === "skipped" ? "skipped" : "sent", sent_via: how === "skipped" ? null : how },
      ...h,
    ]);
    const result = await markOutboxMessage(msg.id, how);
    if (result && "error" in result && result.error) {
      toast.error("That wasn't saved", { description: result.error });
      router.refresh();
    }
  }

  async function undo(msg: Done) {
    setHandled((h) => h.filter((m) => m.id !== msg.id));
    setQueue((q) => [{ ...msg, created_at: new Date().toISOString() }, ...q]);
    await markOutboxMessage(msg.id, "undo");
    router.refresh();
  }

  return (
    <div data-tour="outbox" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {queue.length === 0 ? "Nothing to send" : `${queue.length} to send`}
          </h2>
          <p className="text-sm text-muted-foreground">
            Each one opens WhatsApp — or Messages — with the text already written. Just press send, then come back
            for the next.
          </p>
        </div>
        {queue.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={async () => {
              if (!window.confirm(`Skip all ${queue.length} messages without sending them?`)) return;
              const result = await skipAllPending();
              if (result && "error" in result && result.error) toast.error(result.error);
              router.refresh();
            }}
          >
            Skip all
          </Button>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-white p-10 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Payment links, failed-payment notices and reminders show up here when there&apos;s something to send.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((msg) => {
            const wa = whatsappLink(msg.recipient_phone, msg.message);
            const sms = smsLink(msg.recipient_phone, msg.message);
            const open = expanded === msg.id;
            return (
              <li key={msg.id} data-testid="outbox-message" className="rounded-2xl border bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{msg.recipient_name || "Parent"}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">{formatPhone(msg.recipient_phone)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : msg.id)}
                  className={`mt-1.5 w-full whitespace-pre-line text-left text-sm text-muted-foreground ${open ? "" : "line-clamp-2"}`}
                >
                  {msg.message}
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {wa ? (
                    <>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => mark(msg, "whatsapp")}
                        className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white hover:bg-[#1ebe5b]"
                      >
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </a>
                      <a
                        href={sms!}
                        onClick={() => mark(msg, "sms")}
                        className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
                      >
                        <MessageSquareText className="h-4 w-4" /> Text
                      </a>
                    </>
                  ) : (
                    <p className="self-center text-sm text-amber-700">No usable phone number on file.</p>
                  )}
                  <Button
                    variant="ghost"
                    className="h-11 text-muted-foreground"
                    onClick={() => mark(msg, "skipped")}
                  >
                    Skip
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {handled.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Sent or skipped today</h3>
          <ul className="divide-y rounded-2xl border bg-white">
            {handled.map((msg) => (
              <li key={msg.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {msg.status === "sent" ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {msg.recipient_name || formatPhone(msg.recipient_phone)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {msg.status === "skipped" ? "skipped" : msg.sent_via === "sms" ? "by text" : "on WhatsApp"}
                    </span>
                  </span>
                </span>
                <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => undo(msg)}>
                  <Undo2 className="mr-1 h-4 w-4" /> Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
