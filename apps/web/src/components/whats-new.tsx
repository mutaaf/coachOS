"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { startTour } from "@/components/guided-tour";
import { createClient } from "@/lib/supabase/client";
import type { Release } from "@/lib/releases";
import { PlayCircle, Sparkles } from "lucide-react";

/** One release, as the owner reads it: a title, what changed for her, and "Show me". */
export function ReleaseNotes({ release, onShow }: { release: Release; onShow?: () => void }) {
  return (
    <article data-testid="release" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
          v{release.version}
        </span>
        <h3 className="font-semibold">{release.title}</h3>
        <span className="text-xs text-muted-foreground">
          {new Date(release.released_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
      {release.summary && <p className="text-sm text-muted-foreground">{release.summary}</p>}
      {release.notes.length > 0 && (
        <ul className="space-y-1.5">
          {release.notes.map((n, i) => (
            <li key={i} className="flex items-start justify-between gap-3 text-sm">
              <span>• {n.text}</span>
              {n.tourStep && (
                <button
                  type="button"
                  onClick={() => {
                    onShow?.();
                    startTour(n.tourStep);
                  }}
                  className="shrink-0 font-medium text-primary hover:underline"
                >
                  Show me
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Shown once after a release she hasn't seen. */
export function WhatsNewDialog({ releases, onDone }: { releases: Release[]; onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const steps = [...new Set(releases.flatMap((r) => r.notes.map((n) => n.tourStep).filter(Boolean)))] as string[];

  async function close() {
    setOpen(false);
    onDone();
    // On the account, so her phone and laptop agree.
    await createClient().auth.updateUser({ data: { last_seen_release: releases[0].version } });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg" data-testid="whats-new">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" /> What&rsquo;s new
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {releases.slice(0, 5).map((r) => (
            <ReleaseNotes key={r.version} release={r} onShow={close} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {steps.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                await close();
                startTour(steps);
              }}
            >
              <PlayCircle className="mr-1 h-4 w-4" /> Show me what&rsquo;s new
            </Button>
          )}
          <Button onClick={close}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
