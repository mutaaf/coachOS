"use client";

import { useState } from "react";
import { submitRegistration } from "@/lib/actions/registrations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Result = {
  status: "confirmed" | "waitlisted";
  waitlistPosition: number | null;
  amount: number | null;
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
    });
    setSubmitting(false);
  }

  if (result) {
    const confirmed = result.status === "confirmed";
    return (
      <div
        className={
          confirmed
            ? "rounded-xl border border-emerald-200 bg-emerald-50 p-6"
            : "rounded-xl border border-amber-200 bg-amber-50 p-6"
        }
      >
        <h2
          className={
            confirmed
              ? "text-lg font-semibold text-emerald-900"
              : "text-lg font-semibold text-amber-900"
          }
        >
          {confirmed ? "You're in." : "You're on the waitlist."}
        </h2>
        <p className={confirmed ? "mt-2 text-sm text-emerald-800" : "mt-2 text-sm text-amber-800"}>
          {confirmed ? (
            <>
              Your child has a spot in {programName}. We&apos;ll message you on WhatsApp
              with the schedule and payment details
              {result.amount ? ` (${`$${result.amount}`} per month)` : ""}.
            </>
          ) : (
            <>
              {programName} is full right now. You&apos;re number{" "}
              <strong>{result.waitlistPosition}</strong> in line — if a spot opens, we&apos;ll
              message you before anyone else. Nothing is owed unless a spot comes free.
            </>
          )}
        </p>
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
              <Label htmlFor="parent_phone">WhatsApp number</Label>
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
