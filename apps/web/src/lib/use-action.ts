"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ActionResult = { error?: string; success?: boolean } | void | undefined;

/**
 * Runs a server action and handles the three things every call site was getting
 * wrong on its own.
 *
 * Server actions here report failure by returning `{ error }` rather than
 * throwing, so the usual `try { await action() } catch` never fires — call sites
 * showed "Saved" whether or not anything saved. Attendance could be marked, the
 * dialog would close, and nothing had been written.
 *
 * It also keeps the button in a pending state through the refresh that follows.
 * `router.refresh()` refetches the page on the server, which takes as long as
 * the page does; without a transition the interface just sits there afterwards
 * looking like the click was ignored.
 *
 * And it runs one action at a time. `pending` only disabled the button once a
 * re-render landed, so a quick double tap got in first: two $40 payments, 170ms
 * apart. A ref is set before anything awaits, so the second tap does nothing.
 */
export function useAction() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const pending = running || refreshing;

  /**
   * @param action   the server action to run
   * @param messages `success` is shown when it works, or worked out from what the
   *                 action returned; `error` prefixes whatever the action
   *                 reported, so the real reason still reaches the user
   * @returns        true when the action succeeded
   */
  async function run<R extends ActionResult>(
    action: () => Promise<R>,
    messages: { success?: string | ((result: R) => string); error?: string; refresh?: boolean } = {}
  ): Promise<boolean> {
    const { success, error = "That didn't work", refresh = true } = messages;
    if (busy.current) return false;
    busy.current = true;
    setRunning(true);

    let result: R;
    try {
      result = await action();
    } catch (thrown) {
      // Some actions still throw; report the reason rather than a generic failure.
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      toast.error(error, { description: detail });
      return false;
    } finally {
      busy.current = false;
      setRunning(false);
    }

    if (result && "error" in result && result.error) {
      toast.error(error, { description: result.error });
      return false;
    }

    if (success) toast.success(typeof success === "function" ? success(result) : success);

    if (refresh) {
      // Inside a transition so `pending` stays true until the new data is on
      // screen, not just until the write finished.
      startTransition(() => router.refresh());
    }

    return true;
  }

  return { run, pending };
}
