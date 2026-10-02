"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { startTour } from "@/components/guided-tour";
import type { OnboardingItem } from "@/lib/queries/onboarding";
import { Check, ChevronDown, ChevronUp, PlayCircle } from "lucide-react";

/**
 * The first thing on the dashboard until setup is done: what's left, why, and
 * a button to do it. Each item is worked out from real data, so it can't be
 * ticked off without the thing actually having happened.
 */
export function GettingStarted({ items }: { items: OnboardingItem[] }) {
  const router = useRouter();
  const done = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done);
  const [open, setOpen] = useState(true);

  async function hide() {
    await createClient().auth.updateUser({ data: { checklist_hidden: true } });
    router.refresh();
  }

  return (
    <section data-tour="getting-started" className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Getting started</h2>
          <p className="text-sm text-muted-foreground">
            {done === items.length
              ? "All set — everything runs on its own from here."
              : `${done} of ${items.length} done${next ? ` · Next: ${next.title.toLowerCase()}` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => startTour()}
            className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <PlayCircle className="h-4 w-4" /> Take the tour
          </button>
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setOpen(!open)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>

      {open && (
        <ol className="mt-4 divide-y">
          {items.map((item) => (
            <li key={item.id} data-testid="onboarding-item" className="flex gap-3 py-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-slate-500"
                }`}
              >
                {item.done ? <Check className="h-3.5 w-3.5" /> : items.indexOf(item) + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.title}</p>
                {!item.done && <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>}
                {!item.done && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.id === "tour" ? (
                      <button type="button" onClick={() => startTour()} className={buttonVariants({ size: "sm" })}>
                        {item.action}
                      </button>
                    ) : (
                      <>
                        <Link href={item.href} className={buttonVariants({ size: "sm" })}>
                          {item.action}
                        </Link>
                        <button
                          type="button"
                          onClick={() => startTour(item.tourStep)}
                          className={buttonVariants({ size: "sm", variant: "ghost" })}
                        >
                          Show me
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {done === items.length && (
        <button type="button" onClick={hide} className="mt-2 text-sm text-muted-foreground underline">
          Hide this
        </button>
      )}
    </section>
  );
}
