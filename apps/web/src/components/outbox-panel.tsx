"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markOutboxMessage, skipAllPending } from "@/lib/actions/outbox";
import { smsLink, whatsappLink } from "@/lib/outbox";
import { formatPhone } from "@/lib/utils";
import { Check, Inbox, MessageCircle, MessageSquareText, PenLine, Undo2 } from "lucide-react";

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
export function OutboxPanel({
  waiting,
  done,
  onCompose,
}: {
  waiting: Waiting[];
  done: Done[];
  /** Shown in the empty state, so an empty Outbox points somewhere useful. */
  onCompose?: () => void;
}) {
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
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tabular-nums">
            {queue.length === 0 ? "Nothing to send" : `${queue.length} to send`}
          </h2>
          {queue.length > 1 && (
            <Button
              variant="ghost"
              className="-mr-2 h-11 shrink-0 px-3 text-muted-foreground"
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
        <p className="mt-0.5 text-sm text-muted-foreground">
          Each one opens WhatsApp — or Messages — with the text already written. Just press send, then come back
          for the next.
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Payment links, failed-payment notices and reminders show up here when there&apos;s something to send.
          </p>
          {onCompose && (
            <Button variant="outline" className="mt-4 h-11 w-full sm:w-auto" onClick={onCompose}>
              <PenLine className="mr-2 h-4 w-4" /> Write a message
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((msg) => {
            const wa = whatsappLink(msg.recipient_phone, msg.message);
            const sms = smsLink(msg.recipient_phone, msg.message);
            const open = expanded === msg.id;
            return (
              <li key={msg.id} data-testid="outbox-message" className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <p className="min-w-0 font-semibold leading-snug [overflow-wrap:anywhere]">
                    {msg.recipient_name || "Parent"}
                  </p>
                  <p className="shrink-0 text-sm tabular-nums text-muted-foreground sm:text-xs">
                    {formatPhone(msg.recipient_phone)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : msg.id)}
                  className={`mt-2 w-full whitespace-pre-line text-left text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] ${open ? "" : "line-clamp-2"}`}
                >
                  {msg.message}
                </button>
                <div className="mt-3 flex items-center gap-2">
                  {wa ? (
                    <>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => mark(msg, "whatsapp")}
                        className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#1ebe5b] active:bg-[#1aa851] sm:h-11 sm:flex-none sm:rounded-lg sm:text-sm"
                      >
                        <MessageCircle className="h-5 w-5 sm:h-4 sm:w-4" /> WhatsApp
                      </a>
                      <a
                        href={sms!}
                        onClick={() => mark(msg, "sms")}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors hover:bg-muted active:bg-muted sm:h-11 sm:rounded-lg"
                      >
                        <MessageSquareText className="h-4 w-4" /> Text
                      </a>
                    </>
                  ) : (
                    <p className="flex-1 text-sm text-amber-700">No usable phone number on file.</p>
                  )}
                  <Button
                    variant="ghost"
                    className="h-12 shrink-0 px-3 text-muted-foreground sm:h-11"
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
          <ul className="divide-y rounded-2xl border bg-card">
            {handled.map((msg) => (
              <li key={msg.id} className="flex items-center justify-between gap-3 py-1 pl-4 pr-1.5 text-sm">
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
                <Button variant="ghost" className="h-11 shrink-0 px-3 text-muted-foreground" onClick={() => undo(msg)}>
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
