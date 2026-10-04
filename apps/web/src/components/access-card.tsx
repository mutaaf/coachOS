"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/ui/copy-button";
import { useAction } from "@/lib/use-action";
import { inviteToCoachOS, removeAccess, type Person } from "@/lib/actions/access";

/** Settings → Access: who can sign in, invite someone, take access away. */
export function AccessCard({ people }: { people: Person[] }) {
  const { run, pending } = useAction();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [sending, setSending] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const res = await inviteToCoachOS(email, name);
    setSending(false);
    if ("error" in res && res.error) return toast.error("Not invited", { description: res.error });
    const ok = res as { link: string; emailed: boolean };
    setLink({ email, url: ok.link, emailed: ok.emailed });
    toast.success(ok.emailed ? `Invite emailed to ${email}` : "Invite ready — copy the link below");
    setEmail("");
    setName("");
  }

  return (
    <div className="space-y-6 rounded-2xl border bg-card p-4 sm:p-6" data-testid="access-card">
      <div>
        <h2 className="text-lg font-semibold">Who can sign in</h2>
        <p className="text-sm text-muted-foreground">
          Everyone here can see and change everything. Nobody can make their own account.
        </p>
      </div>
      <ul className="divide-y rounded-xl border">
        {people.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="access-person">
            <div className="min-w-0">
              <p className="break-words font-medium">
                {p.name ? `${p.name} · ` : ""}
                <span className="break-all">{p.email}</span> {p.you && <span className="text-xs text-muted-foreground">(you)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.lastSignIn
                  ? `Last signed in ${new Date(p.lastSignIn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "Hasn't signed in yet"}
              </p>
            </div>
            {!p.you && (
              <Button
                size="sm"
                variant="ghost"
                className="h-10 shrink-0 text-red-600"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Take away ${p.email}'s access? They'll be signed out everywhere.`)) return;
                  run(() => removeAccess(p.id), { success: "Access removed", error: "Access wasn't removed" });
                }}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input id="invite-email" type="email" inputMode="email" autoComplete="off" className="h-11" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Name (optional)</Label>
          <Input id="invite-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" className="h-11 w-full sm:w-auto" disabled={sending || !email}>
          {sending ? "Inviting…" : "Invite"}
        </Button>
      </form>

      {link && (
        <div className="rounded-xl bg-orange-50 p-4 text-sm" data-testid="invite-link">
          <p>
            {link.emailed ? `Emailed to ${link.email}. ` : ""}You can also send them this link — it works once, for 24 hours:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-2 text-xs">{link.url}</code>
            <CopyButton value={link.url} />
          </div>
        </div>
      )}
    </div>
  );
}
