"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Landmark, CreditCard, Lock, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startAutopaySetup, turnOffAutopay, rememberZelleName, saveParentEmail } from "@/lib/actions/pay-page";
import type { PayPageData, PayPageLine } from "@/lib/queries/pay-page";
import { dayOfMonthLabel } from "@/lib/dates";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function monthName(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long" });
}

function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function Line({ line, processing }: { line: PayPageLine; processing?: boolean }) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="break-words font-medium text-slate-900">
          {line.childName} · {monthName(line.month)}
        </p>
        <p className="text-sm text-slate-500">
          {line.programName}
          {" · "}
          {processing ? (
            <span className="whitespace-nowrap text-sky-700">Bank payment on its way</span>
          ) : line.overdue ? (
            <span className="whitespace-nowrap text-red-700">Was due {shortDate(line.dueDate)}</span>
          ) : (
            <span className="whitespace-nowrap">Due {shortDate(line.dueDate)}</span>
          )}
        </p>
      </div>
      <p className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900">{money(line.balanceCents)}</p>
    </li>
  );
}

export function PayPage({
  token,
  data,
  justSetUp,
}: {
  token: string;
  data: PayPageData;
  justSetUp: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [zelleName, setZelleName] = useState("");
  const [zelleSaved, setZelleSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [, startTransition] = useTransition();

  const { parent } = data;
  const children = listNames(data.childNames);
  const feeLabel = data.cardFeePercent > 0 ? `${data.cardFeePercent}% card fee` : "No fee";

  async function setUp(method: "us_bank_account" | "card") {
    setBusy(method);
    setError(null);
    const result = await startAutopaySetup(token, method);
    if ("url" in result && result.url) {
      window.location.href = result.url;
      return;
    }
    setError(("error" in result && result.error) || "That didn't work. Please try again.");
    setBusy(null);
  }

  async function stop() {
    setBusy("off");
    setError(null);
    const result = await turnOffAutopay(token);
    if ("error" in result && result.error) setError(result.error);
    setConfirmingOff(false);
    setBusy(null);
    startTransition(() => router.refresh());
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy("zelle");
    setError(null);
    const result = await rememberZelleName(token, zelleName);
    if ("error" in result && result.error) {
      setError(result.error);
    } else {
      setZelleSaved(true);
      setZelleName("");
      startTransition(() => router.refresh());
    }
    setBusy(null);
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setError(null);
    const result = await saveParentEmail(token, email);
    if ("error" in result && result.error) {
      setError(result.error);
    } else {
      setEmailSaved(true);
      setEmail("");
      startTransition(() => router.refresh());
    }
    setBusy(null);
  }

  // The setting can hold several ("214-555-0100, payments@example.com"); each is
  // its own line with its own copy button, since a parent pastes just one.
  const zelleTargets = (data.zelleRecipient ?? "")
    .split(/\s*(?:,|;|\bor\b)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);

  async function copyRecipient(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked; the number is on screen to type.
    }
  }

  // Only what is owed. A family who has paid is never told to send a month's
  // fee again; if they choose to pay ahead, it is kept as credit.
  const zelleAmount = data.openCents;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-4 pb-10 pt-8 sm:px-5 sm:py-14">
        <header className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            {data.businessName}
          </p>
          <h1 className="mt-3 break-words text-3xl font-bold tracking-tight text-slate-900">
            Hi {parent.firstName}
          </h1>
          {children && (
            <p className="mt-2 text-slate-600">
              Payments for {children}.
            </p>
          )}
        </header>

        {data.testMode && data.stripeEnabled && (
          <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
            Test mode — card and bank payments here are practice runs. No real money moves.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {justSetUp && parent.autopayStatus === "active" && (
          <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="font-semibold text-emerald-900">You&apos;re all set.</p>
            <p className="mt-1 text-sm text-emerald-800">
              Payments will now happen on their own. There&apos;s nothing else to do, and no need to
              message us.
            </p>
          </div>
        )}

        {/* What's owed */}
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          {data.open.length === 0 && data.processing.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <Check aria-hidden="true" className="h-5 w-5 text-emerald-700" />
              </span>
              <div>
                <p className="font-semibold text-slate-900">You&apos;re all paid up</p>
                <p className="text-sm text-slate-500">Thank you!</p>
              </div>
            </div>
          ) : (
            <>
              {data.open.length > 0 && (
                <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    To pay
                  </h2>
                  <p className="whitespace-nowrap text-2xl font-bold tabular-nums text-slate-900">
                    {money(data.openCents)}
                  </p>
                </div>
              )}
              <ul className="divide-y divide-slate-100">
                {data.open.map((line) => (
                  <Line key={line.id} line={line} />
                ))}
                {data.processing.map((line) => (
                  <Line key={line.id} line={line} processing />
                ))}
              </ul>
            </>
          )}
          {data.creditCents > 0 && (
            <p className="mt-2 border-t border-slate-100 pt-3 text-sm text-emerald-800">
              You have {money(data.creditCents)} in credit. It goes toward your next fee.
            </p>
          )}
        </section>

        {/* Autopay */}
        {data.stripeEnabled && (
          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
            {parent.autopayStatus === "active" ? (
              <>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check aria-hidden="true" className="h-5 w-5 text-emerald-700" />
                  </span>
                  <div>
                    <h2 className="font-semibold text-slate-900">Autopay is on</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Paid from {parent.autopayLabel} on each due date
                      {parent.autopayMethod === "card" && data.cardFeePercent > 0
                        ? `, plus a ${data.cardFeePercent}% card fee`
                        : ""}
                      . You&apos;ll never need to send anything.
                    </p>
                  </div>
                </div>
                {data.autopayFailed && (
                  <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                    <p className="font-semibold">Your last automatic payment didn&apos;t go through</p>
                    <p className="mt-0.5">
                      The bank said {data.autopayFailed.reason}. Use a different card or bank account below and
                      we&apos;ll try again within a day — or pay by Zelle.
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap">
                  {confirmingOff ? (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-11 w-full sm:w-auto"
                        disabled={busy !== null}
                        onClick={stop}
                      >
                        {busy === "off" ? "Turning off…" : "Yes, turn off autopay"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 w-full sm:w-auto"
                        onClick={() => setConfirmingOff(false)}
                      >
                        Keep it on
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 w-full sm:w-auto"
                        disabled={busy !== null}
                        onClick={() => setUp(parent.autopayMethod ?? "us_bank_account")}
                      >
                        {parent.autopayMethod === "card" ? "Use a different card" : "Use a different bank account"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 w-full sm:w-auto"
                        disabled={busy !== null}
                        onClick={() => setUp(parent.autopayMethod === "card" ? "us_bank_account" : "card")}
                      >
                        {parent.autopayMethod === "card" ? "Switch to bank (no fee)" : "Switch to card"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 w-full text-slate-600 sm:w-auto"
                        onClick={() => setConfirmingOff(true)}
                      >
                        Turn off
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : parent.autopayStatus === "pending" ? (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100">
                  <Hourglass aria-hidden="true" className="h-5 w-5 text-sky-700" />
                </span>
                <div>
                  <h2 className="font-semibold text-slate-900">One last step</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Your bank will show a small deposit from Stripe in 1–2 business days. Enter the
                    code from it to confirm {parent.autopayLabel ?? "your account"} is yours, and
                    autopay starts.
                  </p>
                  {parent.autopayVerifyUrl && (
                    <a
                      href={parent.autopayVerifyUrl}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white sm:w-auto"
                    >
                      Confirm my bank account
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900">Pay automatically</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Set it up once and each month takes care of itself — no reminders, no messages.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setUp("us_bank_account")}
                    className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-slate-900 bg-slate-900 px-4 py-3 text-left text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Landmark aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span>
                      <span className="block font-semibold">
                        {busy === "us_bank_account" ? "Opening…" : "Bank account"}
                      </span>
                      <span className="block text-sm text-slate-300">No fee</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setUp("card")}
                    className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-left text-slate-900 transition hover:border-slate-300 disabled:opacity-60"
                  >
                    <CreditCard aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span>
                      <span className="block font-semibold">
                        {busy === "card" ? "Opening…" : "Card"}
                      </span>
                      <span className="block text-sm text-slate-500">{feeLabel}</span>
                    </span>
                  </button>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-500">
                  {data.openCents > 0 && (
                    <>
                      Your current balance of {money(data.openCents)} will be paid within a day.{" "}
                    </>
                  )}
                  After that, each month&apos;s fee is paid on its due date (the {dayOfMonthLabel(data.dueDay)}). Turn it off
                  here whenever you like.
                </p>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
                  <Lock aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /> Bank and card details are handled by Stripe. We
                  never see them.
                </p>
              </>
            )}
          </section>
        )}

        {/* Zelle */}
        {data.zelleRecipient && (parent.autopayStatus !== "active" || data.autopayFailed) && (
          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {data.stripeEnabled ? "Prefer Zelle?" : "Pay with Zelle"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {zelleAmount > 0 ? <>Send {money(zelleAmount)} to</> : <>Nothing is owed right now. To pay ahead, send to</>}
              {zelleTargets.length > 1 ? " either of these" : ""}
            </p>
            <div className="mt-2 space-y-2">
              {zelleTargets.map((target, i) => (
                <div key={target}>
                  {i > 0 && <p className="mb-2 text-center text-xs text-slate-400">or</p>}
                  <button
                    type="button"
                    onClick={() => copyRecipient(target)}
                    aria-label={`Copy ${target}`}
                    className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-left transition active:bg-slate-100"
                  >
                    <span className="min-w-0 break-all font-mono text-base font-semibold text-slate-900">
                      {target}
                    </span>
                    <span aria-live="polite" className="flex shrink-0 items-center gap-1 text-sm font-medium text-slate-600">
                      {copied === target ? (
                        <>
                          <Check aria-hidden="true" className="h-4 w-4 text-emerald-700" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy aria-hidden="true" className="h-4 w-4" /> Copy
                        </>
                      )}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              No need to message us when you&apos;ve sent it — we&apos;ll see it come in and mark it
              paid.
            </p>

            <form onSubmit={saveName} className="mt-4 border-t border-slate-100 pt-4">
              <label htmlFor="zelle_name" className="text-sm font-medium text-slate-900">
                Sending from an account in someone else&apos;s name?
              </label>
              <p className="mt-0.5 text-sm text-slate-500">
                Tell us whose, so we know it&apos;s from you.
              </p>
              {data.zelleNames.length > 0 && (
                <p className="mt-2 text-sm text-slate-600">
                  We&apos;ll recognise: {data.zelleNames.join(", ")}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Input
                  id="zelle_name"
                  value={zelleName}
                  onChange={(e) => {
                    setZelleName(e.target.value);
                    setZelleSaved(false);
                  }}
                  placeholder="Name on the account"
                  autoComplete="off"
                  className="h-11 min-w-0 text-base sm:text-sm"
                />
                <Button type="submit" className="h-11 shrink-0 px-5" disabled={busy !== null || !zelleName.trim()}>
                  {busy === "zelle" ? "Saving…" : "Save"}
                </Button>
              </div>
              {zelleSaved && <p role="status" className="mt-2 text-sm text-emerald-700">Saved — thank you.</p>}
            </form>
          </section>
        )}

        {/* Receipts */}
        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
          <form onSubmit={saveEmail}>
            <label htmlFor="receipt_email" className="font-semibold text-slate-900">
              Receipts by email
            </label>
            <p className="mt-0.5 text-sm text-slate-600">
              {parent.emailHint
                ? `We send a receipt to ${parent.emailHint} whenever a payment comes in. Change it below.`
                : "Get a receipt whenever a payment comes in — handy for your records or an employer."}
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                id="receipt_email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailSaved(false);
                }}
                placeholder="you@example.com"
                className="h-11 min-w-0 text-base sm:text-sm"
              />
              <Button type="submit" className="h-11 shrink-0 px-5" disabled={busy !== null || !email.trim()}>
                {busy === "email" ? "Saving…" : "Save"}
              </Button>
            </div>
            {emailSaved && <p role="status" className="mt-2 text-sm text-emerald-700">Saved — receipts will go there.</p>}
          </form>
        </section>

        <p className="mt-8 text-center text-xs text-slate-500">
          Questions? Just reply to any email from us.
        </p>
      </div>
    </main>
  );
}
