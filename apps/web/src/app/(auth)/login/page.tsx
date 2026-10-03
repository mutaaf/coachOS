"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isAdmin } from "@/lib/admin";
import { requestPasswordLink } from "@/lib/actions/access";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  // "Get a new password link" from an expired invite lands here with ?forgot=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("forgot")) setForgot(true);
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    const res = await requestPasswordLink(email);
    setIsLoading(false);
    if ("error" in res && res.error) return toast.error(res.error);
    setLinkSent(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }
      // An account isn't access: the dashboard would turn it away anyway.
      if (!isAdmin(data.user)) {
        await supabase.auth.signOut();
        toast.error("This account doesn't have access to CoachOS. Ask Mutaaf to give it access.");
        return;
      }

      toast.success("Signed in successfully");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm border-0 bg-white shadow-lg shadow-black/5 rounded-2xl">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-col items-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-lg">
            CO
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">
            CoachOS
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Sign in to manage your programs
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        {forgot ? (
          linkSent ? (
            <div className="space-y-3 text-center" data-testid="link-sent">
              <p>If {email} has access, a link to choose a new password is on its way. ⚽</p>
              <Button variant="ghost" onClick={() => { setForgot(false); setLinkSent(false); }}>Back to sign in</Button>
            </div>
          ) : (
            <form onSubmit={sendLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Your email</Label>
                <Input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={isLoading}>
                {isLoading ? "Sending…" : "Email me a link"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setForgot(false)}>Back to sign in</Button>
            </form>
          )
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={isLoading}
            />
          </div>

          <Button
            type="submit"
            className="w-full rounded-xl"
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
          <button type="button" onClick={() => setForgot(true)} className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
            Forgot your password?
          </button>
        </form>
        )}
      </CardContent>
    </Card>
  );
}
