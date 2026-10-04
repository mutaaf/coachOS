"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isAdmin } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BouncingBall } from "@/components/celebration";

/**
 * Where an invite or a password link lands: check the link, then choose a
 * password. The link (token_hash) works once; once checked, it signs you in,
 * and setting the password is the last step.
 */
function Welcome() {
  const params = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "bad" | "saving">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invite = params.get("type") === "invite";
  // One client for the whole page: the session the link creates must be the
  // one that sets the password.
  const supabase = useMemo(() => createClient(), []);
  // The link works once. React may run effects twice in development; a second
  // check of a spent link would fail and throw the new session away.
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const token_hash = params.get("token_hash");
    const type = params.get("type") === "invite" ? "invite" : "recovery";
    if (!token_hash) return setState("bad");
    supabase.auth
      .verifyOtp({ token_hash, type })
      .then(({ data, error }) => setState(error || !isAdmin(data.user) ? "bad" : "ready"));
  }, [params, supabase]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== again) return setError("Those two don't match.");
    setError(null);
    setState("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setState("ready");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (state === "checking") return <p className="text-center text-slate-600">Checking your link…</p>;
  if (state === "bad")
    return (
      <div className="text-center" data-testid="welcome-bad">
        <h1 className="text-2xl font-bold text-balance">That link has expired or been used</h1>
        <p className="mt-2 text-slate-600">
          Links work once, for 24 hours. Ask whoever invited you to send a new one, or{" "}
          <Link href="/login?forgot=1" className="inline-block py-2 font-semibold text-orange-600 underline">
            get a new password link
          </Link>
          .
        </p>
      </div>
    );

  return (
    <form onSubmit={save} className="space-y-4" data-testid="welcome-form">
      <div className="text-center">
        <BouncingBall className="text-5xl" />
        <h1 className="mt-2 text-2xl font-extrabold">{invite ? "Welcome to the team! 🎉" : "Choose a new password"}</h1>
        <p className="mt-1 text-slate-600">{invite ? "Choose a password and you're in." : "Then you're back in."}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">Password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password-again">Same password again</Label>
        <Input id="new-password-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="h-11 w-full" disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : invite ? "Let's go" : "Save and sign in"}
      </Button>
    </form>
  );
}

export default function WelcomePage() {
  return (
    // Fixed over the sign-in layout's grey, so the orange fills the screen.
    <main className="fixed inset-0 overflow-y-auto bg-orange-50">
      <div className="flex min-h-full items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm sm:p-7">
          <Suspense fallback={null}>
            <Welcome />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
