/**
 * Shown the instant a dashboard link is clicked, while the server fetches.
 *
 * Without a loading state, Next holds the previous page on screen until the new
 * one is ready — half a second of nothing happening after a click, which reads
 * as the app being stuck rather than busy.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-muted" />
        <div className="h-4 w-80 rounded bg-muted/60" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border bg-card p-4">
            <div className="h-3 w-20 rounded bg-muted/60" />
            <div className="mt-3 h-6 w-14 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-xl border bg-card p-4"
            // Each row fades in slightly later, so the list reads as arriving
            // rather than flashing in as one block.
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="space-y-2">
              <div className="h-4 w-48 rounded bg-muted" />
              <div className="h-3 w-64 rounded bg-muted/60" />
            </div>
            <div className="h-8 w-24 rounded-lg bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
