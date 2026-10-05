"use client";

import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { PhoneLink } from "@/components/phone-link";
import { updateInquiryStatus } from "@/lib/actions/inquiries";
import { attributionSummary } from "@/lib/attribution";
import { formatBusinessTime } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import type { InquiryWithOffering } from "@/lib/queries/inquiries";
import { INQUIRY_STATUSES, type InquiryKind, type InquiryStatus } from "@/types/database";

const STATUS: Record<InquiryStatus, { label: string; color: string }> = {
  new: { label: "New", color: "bg-sky-100 text-sky-800" },
  contacted: { label: "Contacted", color: "bg-blue-100 text-blue-700" },
  trial_booked: { label: "Trial booked", color: "bg-purple-100 text-purple-700" },
  registered: { label: "Registered", color: "bg-green-100 text-green-700" },
  lost: { label: "Lost", color: "bg-red-100 text-red-700" },
};

const KIND: Record<InquiryKind, string> = {
  general: "Question",
  trial: "Free trial",
  waitlist_interest: "Tell me when it opens",
  program_question: "About a program",
  birthday_party: "Birthday party",
  privacy_request: "Privacy request",
};

/**
 * Families' questions from the website's forms (public.submit_inquiry). Each
 * one is worked like a lead: reply, book a trial, and mark where it got to.
 */
export function InquiriesPanel({ inquiries }: { inquiries: InquiryWithOffering[] }) {
  const { run, pending } = useAction();
  const [filter, setFilter] = useState<InquiryStatus | "open" | "all">("open");
  const open = inquiries.filter((i) => i.status !== "registered" && i.status !== "lost");
  const shown =
    filter === "all" ? inquiries : filter === "open" ? open : inquiries.filter((i) => i.status === filter);

  const chips: { value: typeof filter; label: string; count: number }[] = [
    { value: "open", label: "Open", count: open.length },
    ...INQUIRY_STATUSES.map((s) => ({ value: s, label: STATUS[s].label, count: inquiries.filter((i) => i.status === s).length })),
    { value: "all", label: "All", count: inquiries.length },
  ];

  return (
    <div className="space-y-4">
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Show inquiries"
      >
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setFilter(c.value)}
            className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${
              filter === c.value ? "border-foreground bg-foreground text-background" : "bg-white text-foreground"
            }`}
          >
            {c.label}
            <span className={`tabular-nums text-xs ${filter === c.value ? "opacity-80" : "text-muted-foreground"}`}>{c.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {inquiries.length === 0
            ? "No inquiries yet. Questions, trial requests and “tell me when it opens” from the website land here."
            : "Nothing here. Tap All to see every inquiry."}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((i) => {
          const name = [i.first_name, i.last_name].filter(Boolean).join(" ") || "Someone";
          const source = attributionSummary(i.attribution);
          return (
            <article key={i.id} data-testid="inquiry" className="min-w-0 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {KIND[i.kind] ?? i.kind} · {formatBusinessTime(i.created_at)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[i.status].color}`}>
                  {STATUS[i.status].label}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                {i.phone && <PhoneLink phone={i.phone} />}
                {i.email && (
                  <a href={`mailto:${i.email}`} className="inline-flex min-h-10 min-w-0 items-center gap-1 hover:text-foreground hover:underline">
                    <Mail className="h-3 w-3 shrink-0" /> <span className="break-all">{i.email}</span>
                  </a>
                )}
              </div>

              {i.message && (
                <p className="mt-1 flex gap-1.5 break-words text-sm">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {i.message}
                </p>
              )}

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {i.offering && (
                  <>
                    <dt className="text-muted-foreground">Program</dt>
                    <dd className="break-words">
                      {i.offering.name}
                      {i.offering.school?.name ? ` · ${i.offering.school.name}` : ""}
                    </dd>
                  </>
                )}
                {i.child_ages && (
                  <>
                    <dt className="text-muted-foreground">Child ages</dt>
                    <dd>{i.child_ages}</dd>
                  </>
                )}
                {i.sport && (
                  <>
                    <dt className="text-muted-foreground">Sport</dt>
                    <dd>{i.sport}</dd>
                  </>
                )}
                {i.inquiry_types.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Interested in</dt>
                    <dd className="break-words">{i.inquiry_types.join(", ")}</dd>
                  </>
                )}
                {i.preferred_date && (
                  <>
                    <dt className="text-muted-foreground">Preferred date</dt>
                    <dd>{i.preferred_date}</dd>
                  </>
                )}
                {source && (
                  <>
                    <dt className="text-muted-foreground">Came from</dt>
                    <dd className="break-words" data-testid="inquiry-source">{source}</dd>
                  </>
                )}
              </dl>

              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Status of ${name}'s inquiry`}>
                {INQUIRY_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    aria-pressed={i.status === s}
                    onClick={() =>
                      i.status !== s &&
                      run(() => updateInquiryStatus(i.id, s), { success: `Marked ${STATUS[s].label.toLowerCase()}`, error: "Not changed" })
                    }
                    className={`h-10 rounded-full px-3.5 text-sm transition-colors ${
                      i.status === s ? `${STATUS[s].color} font-semibold ring-2 ring-inset ring-current` : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {STATUS[s].label}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
