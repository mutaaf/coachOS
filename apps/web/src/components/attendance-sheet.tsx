"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Status = "present" | "absent" | "late" | "excused";

interface Child {
  student_id: string;
  first_name: string;
  last_name: string;
  medical_notes: string | null;
  status: Status | null;
}

interface Session {
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  program_name: string;
  school_name: string;
  location: string | null;
}

const CYCLE: Status[] = ["present", "absent", "late", "excused"];

const STATUS_STYLE: Record<Status, string> = {
  present: "bg-green-600 text-white border-green-600",
  absent: "bg-red-600 text-white border-red-600",
  late: "bg-amber-500 text-white border-amber-500",
  excused: "bg-slate-500 text-white border-slate-500",
};

const STATUS_LABEL: Record<Status, string> = {
  present: "Here",
  absent: "Away",
  late: "Late",
  excused: "Excused",
};

/**
 * The register a coach opens on their phone.
 *
 * The roster is fetched only after the passcode is accepted, so nothing about
 * the children is in the page until someone is authorised. The passcode is kept
 * in memory for the session and sent with the save — it is never stored.
 */
export function AttendanceSheet({ token }: { token: string }) {
  // A plain anon client against the `public` schema — deliberately not the
  // app's `ops`-scoped one. Everything this page can reach is whatever the two
  // passcode-guarded functions allow, and nothing else.
  const [supabase] = useState(() =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )
  );

  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [roster, setRoster] = useState<Child[]>([]);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("open_attendance_sheet", {
      p_token: token,
      p_passcode: passcode,
    });

    setBusy(false);

    if (rpcError) {
      setError("Something went wrong. Try again in a moment.");
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setSession(data.session);
    setRoster(data.roster);
    // Anyone already marked keeps their mark; everyone else starts as here,
    // because on a normal day most of them are.
    setMarks(
      Object.fromEntries(
        (data.roster as Child[]).map((c) => [c.student_id, c.status ?? "present"])
      )
    );
    setUnlocked(true);
  }

  function cycle(studentId: string) {
    setSaved(false);
    setMarks((prev) => {
      const current = prev[studentId] ?? "present";
      return { ...prev, [studentId]: CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length] };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("save_attendance_sheet", {
      p_token: token,
      p_passcode: passcode,
      p_records: roster.map((c) => ({
        student_id: c.student_id,
        status: marks[c.student_id] ?? "present",
      })),
    });

    setBusy(false);

    if (rpcError) {
      setError("The register didn't save. Check your signal and try again.");
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setSaved(true);
  }

  if (!unlocked) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-5 py-12">
        <form onSubmit={unlock} className="w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            Rising Stars
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Take the register
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter the passcode you were sent with this link.
          </p>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value.replace(/\D/g, ""))}
            aria-label="Passcode"
            className="mt-6 w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-center text-2xl tracking-[0.4em] tabular-nums focus:border-slate-900 focus:outline-none"
            placeholder="000000"
            autoFocus
          />

          {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || passcode.length < 6}
            className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3.5 font-medium text-white disabled:opacity-40"
          >
            {busy ? "Checking…" : "Open register"}
          </button>
        </form>
      </main>
    );
  }

  const present = Object.values(marks).filter((s) => s === "present" || s === "late").length;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg px-4 py-8 pb-32">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            Rising Stars
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {session!.program_name}
          </h1>
          <p className="mt-1 text-slate-600">
            {session!.school_name}
            {session!.location ? ` · ${session!.location}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {new Date(`${session!.date}T12:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · {session!.start_time?.slice(0, 5)}–{session!.end_time?.slice(0, 5)}
          </p>
        </header>

        <p className="mt-6 text-sm font-medium text-slate-700">
          {present} of {roster.length} here
        </p>

        {roster.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">
            Nobody is enrolled in this program yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {roster.map((child) => {
              const status = marks[child.student_id] ?? "present";
              return (
                <li key={child.student_id}>
                  <button
                    type="button"
                    onClick={() => cycle(child.student_id)}
                    // Big tap target: this is used standing up, on a phone,
                    // usually in a noisy gym.
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left active:scale-[0.99] transition-transform"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900">
                        {child.first_name} {child.last_name}
                      </span>
                      {child.medical_notes && (
                        <span className="mt-0.5 block text-sm text-amber-700">
                          {child.medical_notes}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold ${STATUS_STYLE[status]}`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Tap a name to change it. Nothing is sent until you save.
        </p>
      </div>

      {/* Save stays reachable without scrolling back up. */}
      {roster.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
          <div className="mx-auto max-w-lg">
            {error && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              onClick={save}
              disabled={busy}
              className={`w-full rounded-xl px-4 py-3.5 font-medium text-white disabled:opacity-50 ${
                saved ? "bg-green-600" : "bg-slate-900"
              }`}
            >
              {busy ? "Saving…" : saved ? "Saved ✓" : "Save register"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
