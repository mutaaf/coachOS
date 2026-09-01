import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { RegistrationForm } from "@/components/registration-form";
import type { ProgramAvailability } from "@/types/database";

// Seat counts change as parents register, so never serve this from a cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("program_availability")
    .select("name, school_name")
    .eq("public_slug", params.slug)
    .maybeSingle();

  if (!data) return { title: "Registration — Rising Stars" };

  return {
    title: `${data.name} — Rising Stars`,
    description: `Register your child for ${data.name} at ${data.school_name}.`,
  };
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt((start ?? end)!);
}

export default async function JoinPage({ params }: { params: { slug: string } }) {
  const supabase = createAdminSupabase();

  const { data } = await supabase
    .from("program_availability")
    .select("*")
    .eq("public_slug", params.slug)
    .maybeSingle();

  if (!data) notFound();

  const program = data as ProgramAvailability;
  const dateRange = formatDateRange(program.start_date, program.end_date);
  const isFull = program.seats_remaining < 1;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            Rising Stars Youth Academy
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {program.name}
          </h1>
          <p className="mt-2 text-lg text-slate-600">{program.school_name}</p>

          {program.public_description && (
            <p className="mt-5 leading-relaxed text-slate-700">
              {program.public_description}
            </p>
          )}

          <dl className="mt-7 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
            {program.location && (
              <div className="bg-white px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Where
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {program.location}
                </dd>
              </div>
            )}
            {dateRange && (
              <div className="bg-white px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  When
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{dateRange}</dd>
              </div>
            )}
            <div className="bg-white px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Cost
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                ${Number(program.monthly_fee).toFixed(0)} per month
              </dd>
            </div>
            <div className="bg-white px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Spots
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {isFull ? (
                  <span className="text-amber-700">
                    {program.waitlist_count > 0
                      ? `Full · ${program.waitlist_count} on the waitlist`
                      : "Full"}
                  </span>
                ) : (
                  <>
                    {program.seats_remaining} of {program.capacity} left
                  </>
                )}
              </dd>
            </div>
          </dl>
        </header>

        {!program.registration_open ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="font-medium text-slate-900">Registration isn&apos;t open yet</p>
            <p className="mt-1 text-sm text-slate-600">
              Check back soon, or message us and we&apos;ll let you know when it opens.
            </p>
          </div>
        ) : (
          <RegistrationForm
            programId={program.program_id}
            programName={program.name}
            seatsRemaining={program.seats_remaining}
            monthlyFee={Number(program.monthly_fee)}
          />
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          Questions? Reply to the WhatsApp group or message us directly.
        </p>
      </div>
    </main>
  );
}
