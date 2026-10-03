"use client";

import { useState } from "react";
import { submitRegistration } from "@/lib/actions/registrations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BouncingBall, ConfettiBurst } from "@/components/celebration";

type Result = {
  status: "confirmed" | "waitlisted";
  waitlistPosition: number | null;
  amount: number | null;
  whatsappGroupUrl: string | null;
  childName: string;
  email: string | null;
  phone: string;
};

export function RegistrationForm({
  programId,
  programName,
  seatsRemaining,
  monthlyFee,
}: {
  programId: string;
  programName: string;
  seatsRemaining: number;
  monthlyFee: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.set("program_id", programId);

    const response = await submitRegistration(formData);

    if (response.error) {
      setError(response.error);
      setSubmitting(false);
      return;
    }

    setResult({
      status: response.status as "confirmed" | "waitlisted",
      waitlistPosition: response.waitlistPosition ?? null,
      amount: response.amount ?? null,
      whatsappGroupUrl: (response as { whatsappGroupUrl?: string | null }).whatsappGroupUrl ?? null,
      childName: String(formData.get("child_first_name") ?? "").trim(),
      email: String(formData.get("parent_email") ?? "").trim() || null,
      phone: String(formData.get("parent_phone") ?? "").trim(),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setSubmitting(false);
  }

  if (result) {
    const waitlisted = result.status === "waitlisted";
    const child = result.childName || "Your child";
    return (
      <div data-testid="registration-done" className="relative">
        {!waitlisted && <ConfettiBurst />}
        <div
          className={`overflow-hidden rounded-3xl border-2 bg-white text-center shadow-sm ${
            waitlisted ? "border-amber-200" : "border-orange-200"
          }`}
        >
          <div className={waitlisted ? "bg-amber-50 px-6 pb-6 pt-8" : "bg-gradient-to-b from-orange-100 to-white px-6 pb-6 pt-8"}>
            {waitlisted ? (
              <span aria-hidden="true" className="text-5xl">🤞</span>
            ) : (
              <BouncingBall className="text-6xl" />
            )}
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {waitlisted ? `${child} is on the list!` : `${child} is in! 🎉`}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-slate-700">
              {waitlisted ? (
                <>
                  {programName} is full right now, so we&apos;ve saved a place in line —{" "}
                  number <strong>{result.waitlistPosition}</strong>. You&apos;ll hear from us first if a spot
                  opens. Nothing is owed unless one does.
                </>
              ) : (
                <>
                  Welcome to <strong>{programName}</strong>! We can&apos;t wait to see {result.childName || "them"} on
                  the field
                  {result.amount ? <> ({`$${result.amount}`} a month — we&apos;ll send your payment link)</> : null}.
                </>
              )}
            </p>
          </div>

          <div className="space-y-4 px-6 pb-8 pt-2">
            {!waitlisted && result.whatsappGroupUrl && (
              <a
                href={result.whatsappGroupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 text-base font-bold text-white shadow-sm transition hover:brightness-95"
              >
                💬 Join the team group chat
              </a>
            )}
            <p className="text-sm text-slate-600">
              {result.email ? (
                <>
                  We&apos;ve emailed the details to <strong>{result.email}</strong>.
                </>
              ) : (
                <>We&apos;ll text you at {result.phone} with the details.</>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-6">
      {seatsRemaining < 1 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This program is full. You can still sign up — you&apos;ll be added to the
          waitlist and we&apos;ll message you the moment a spot opens.
        </div>
      )}
      {seatsRemaining > 0 && seatsRemaining <= 3 && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          Only {seatsRemaining} {seatsRemaining === 1 ? "spot" : "spots"} left.
        </div>
      )}

      <fieldset disabled={submitting} className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your child
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="child_first_name">First name</Label>
              <Input id="child_first_name" name="child_first_name" required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="child_last_name">Last name</Label>
              <Input id="child_last_name" name="child_last_name" required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="child_grade">Grade</Label>
              <Input id="child_grade" name="child_grade" placeholder="e.g. 3rd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="child_date_of_birth">Date of birth</Label>
              <Input id="child_date_of_birth" name="child_date_of_birth" type="date" />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Parent or guardian
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="parent_first_name">First name</Label>
              <Input
                id="parent_first_name"
                name="parent_first_name"
                required
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent_last_name">Last name</Label>
              <Input
                id="parent_last_name"
                name="parent_last_name"
                required
                autoComplete="family-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent_phone">Mobile number</Label>
              <Input
                id="parent_phone"
                name="parent_phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="(214) 555-0123"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent_email">Email (optional)</Label>
              <Input id="parent_email" name="parent_email" type="email" autoComplete="email" />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="medical_notes">
            Anything we should know? (allergies, injuries, medical)
          </Label>
          <Textarea id="medical_notes" name="medical_notes" rows={3} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="how_heard">How did you hear about us? (optional)</Label>
          <Input id="how_heard" name="how_heard" placeholder="A friend, the school, Facebook…" />
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            ${monthlyFee.toFixed(0)}/month · no payment due right now
          </p>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting
              ? "Submitting…"
              : seatsRemaining < 1
                ? "Join the waitlist"
                : "Register"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
