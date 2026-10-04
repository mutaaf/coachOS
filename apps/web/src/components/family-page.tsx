import Link from "next/link";
import { ArrowLeft, GraduationCap, Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { PhoneLink } from "@/components/phone-link";
import type { Family } from "@/lib/queries/families";
import { familyHref } from "@/lib/family-link";
import { formatCurrency } from "@/lib/utils";
import { formatBusinessTime, formatDateOnly } from "@/lib/dates";

const invoiceVariant: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  paid: "success",
  pending: "warning",
  overdue: "destructive",
  waived: "secondary",
  processing: "secondary",
};

const messageStatus: Record<string, string> = {
  pending: "waiting in Outbox",
  sending: "waiting in Outbox",
  sent: "sent",
  skipped: "skipped",
  failed: "not sent",
};

const money = (cents: number) => formatCurrency(cents / 100);

/**
 * One family on one page: what a parent asks about on WhatsApp. Who the
 * children are and where they play, who looks after them, what they owe and
 * the link to pay it, and what she has sent them.
 */
export function FamilyPage({ family, payLink }: { family: Family; payLink: string }) {
  const { parent, guardians, children, invoices, owedCents, processingCents, creditCents, messages } = family;
  const open = invoices.filter((i) => i.balanceCents > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/students"
          className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1 px-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
        >
          <ArrowLeft className="h-4 w-4" /> Students & Parents
        </Link>
        <h1 className="break-words text-2xl font-bold">The {parent.last_name || parent.first_name} family</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {children.length === 1 ? "1 child" : `${children.length} children`} ·{" "}
          {guardians.length === 1 ? "1 parent" : `${guardians.length} parents`} — what they owe, and what you&apos;ve sent them.
        </p>
      </div>

      <div data-tour="family-balance" className="rounded-2xl border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">They owe</p>
            <p
              data-testid="family-owed"
              className={`text-3xl font-bold tabular-nums ${owedCents > 0 ? "text-red-600" : "text-green-700"}`}
            >
              {money(owedCents)}
            </p>
            {processingCents > 0 && (
              <p className="text-sm text-muted-foreground">
                {money(processingCents)} more is on its way from their bank.
              </p>
            )}
            {creditCents > 0 && (
              <p className="text-sm text-green-700">
                {money(creditCents)} credit on file — it pays their next invoice.
              </p>
            )}
          </div>
          <div className="min-w-0 sm:max-w-sm">
            <p className="mb-1 text-sm text-muted-foreground">Their payment page</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{payLink}</code>
              <CopyButton value={payLink} label="Copy link" size="md" className="sm:h-10 sm:px-3 sm:text-xs" />
            </div>
          </div>
        </div>
        {open.length > 0 && (
          <ul className="mt-4 divide-y border-t text-sm">
            {open.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="hidden min-w-0 sm:inline">
                  {inv.studentName} · {inv.programName} · {inv.month}
                </span>
                <span className="min-w-0 sm:hidden">
                  <span className="block truncate font-medium">
                    {inv.studentName} · {inv.month}
                  </span>
                  <span className="block truncate text-muted-foreground">{inv.programName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant={invoiceVariant[inv.status] || "secondary"}>{inv.status}</Badge>
                  <span className="whitespace-nowrap font-medium tabular-nums">{money(inv.balanceCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Children</h2>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">No children linked yet.</p>
          ) : (
            <ul className="space-y-3">
              {children.map((c) => (
                <li key={c.id}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    {c.first_name} {c.last_name}
                    {c.grade && (
                      <span className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
                        <GraduationCap className="h-3.5 w-3.5" /> {c.grade}
                      </span>
                    )}
                    {c.status === "inactive" && <Badge variant="secondary">archived</Badge>}
                  </div>
                  {c.medical_notes && <p className="text-xs text-orange-600">Medical: {c.medical_notes}</p>}
                  {c.enrollments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Not enrolled</p>
                  ) : (
                    c.enrollments.map((e) => (
                      <p key={e.id} className="text-sm">
                        {e.schoolName} — {e.programName}
                        {e.status !== "active" && <span className="text-muted-foreground"> ({e.status})</span>}
                      </p>
                    ))
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Parents & guardians</h2>
          <ul className="space-y-3">
            {guardians.map((g) => (
              <li key={g.id}>
                <div className="break-words font-medium">
                  {g.id === parent.id ? (
                    `${g.first_name} ${g.last_name}`
                  ) : (
                    <Link href={familyHref(g.id)} className="hover:underline">
                      {g.first_name} {g.last_name}
                    </Link>
                  )}
                  <span className="font-normal text-muted-foreground"> ({g.relationship})</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <PhoneLink phone={g.phone} />
                  {g.email && (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{g.email}</span>
                    </span>
                  )}
                  <span>Pays by {g.preferred_payment}</span>
                  {g.autopay_status === "active" && <span>Autopay on</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <>
          <ul className="divide-y md:hidden">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {inv.studentName} · {inv.month}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {inv.programName} · due {formatDateOnly(inv.due_date)}
                  </p>
                  <p className="mt-0.5 whitespace-nowrap tabular-nums text-muted-foreground">
                    {inv.balanceCents > 0 ? (
                      <>
                        <span className="font-medium text-foreground">{money(inv.balanceCents)}</span> left of{" "}
                        {formatCurrency(inv.amount)}
                      </>
                    ) : (
                      formatCurrency(inv.amount)
                    )}
                  </p>
                </div>
                <Badge variant={invoiceVariant[inv.status] || "secondary"} className="shrink-0">
                  {inv.status}
                </Badge>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="py-2 pr-3 font-medium">Child</th>
                  <th className="hidden py-2 pr-3 font-medium sm:table-cell">Program</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Balance</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {inv.month}
                      <span className="block text-xs text-muted-foreground">due {formatDateOnly(inv.due_date)}</span>
                    </td>
                    <td className="py-2 pr-3">{inv.studentName}</td>
                    <td className="hidden py-2 pr-3 sm:table-cell">{inv.programName}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatCurrency(inv.amount)}</td>
                    <td className="py-2 pr-3 font-medium tabular-nums">{inv.balanceCents > 0 ? money(inv.balanceCents) : "—"}</td>
                    <td className="py-2">
                      <Badge variant={invoiceVariant[inv.status] || "secondary"}>{inv.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Messages</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent to this family yet.</p>
        ) : (
          <ul className="divide-y">
            {messages.map((m) => (
              <li key={m.id} className="py-2.5 text-sm">
                <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                  {m.recipient_name && <span>To {m.recipient_name}</span>}
                  <span>· {formatBusinessTime(m.created_at)}</span>
                  <span>· {messageStatus[m.status] ?? m.status}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{m.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
