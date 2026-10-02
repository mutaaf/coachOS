import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { getStripeSettings } from "@/lib/stripe-client";

export interface OnboardingItem {
  id: string;
  title: string;
  body: string;
  done: boolean;
  href: string;
  action: string;
  /** Tour step to start from for "Show me". */
  tourStep: string;
}

/**
 * The getting-started list, worked out from what has actually happened rather
 * than from boxes ticked by hand — it can't say "done" for something that
 * isn't.
 */
export async function getOnboarding(): Promise<{ items: OnboardingItem[]; hidden: boolean } | null> {
  const { data: auth } = await createServerSupabase().auth.getUser();
  if (!auth.user) return null;
  const meta = (auth.user.user_metadata ?? {}) as Record<string, unknown>;

  const db = createAdminSupabase();
  const stripe = await getStripeSettings();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [enrollments, receipts, handSent, config] = await Promise.all([
    count(db.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active")),
    count(db.from("zelle_receipts").select("id", { count: "exact", head: true })),
    count(db.from("message_queue").select("id", { count: "exact", head: true }).not("sent_via", "is", null)),
    db
      .from("config")
      .select("key, value")
      .in("key", [
        "zelle_recipient",
        "email_reply_to",
        "zelle_alerts_inbox",
        "zelle_alerts_forward_from",
      ]),
  ]);
  const c = Object.fromEntries((config.data || []).map((r) => [r.key, r.value as string]));
  const inbox = c.zelle_alerts_inbox?.trim();
  const forwardFrom = c.zelle_alerts_forward_from?.trim();

  const items: OnboardingItem[] = [
    {
      id: "roster",
      title: "Import your first session's roster",
      body: "A screenshot of the WhatsApp group or your spreadsheet is enough. The school and session are created as you go.",
      done: enrollments > 0,
      href: "/schools",
      action: "Import a roster",
      tourStep: "schools-import",
    },
    {
      id: "details",
      title: "Check your Zelle details and email addresses",
      body: "Where parents send Zelle, the inbox that gets replies to receipts, and the Gmail your Zelle alerts reach.",
      done: !!c.zelle_recipient?.trim() && !!c.email_reply_to?.trim() && !!inbox,
      href: "/settings",
      action: "Open Settings",
      tourStep: "settings",
    },
    {
      id: "zelle",
      title: "Connect Zelle emails",
      body: !inbox
        ? "First, in Settings, enter the Gmail your Zelle alerts reach. Then a one-time setup on a computer (about 3 minutes)."
        : forwardFrom
          ? `One-time setup on a computer (about 3 minutes). Then forward Zelle alerts from ${forwardFrom} to ${inbox} and they record themselves.`
          : `One-time setup on a computer (about 3 minutes). After that, Zelle alerts reaching ${inbox} record themselves.`,
      done: receipts > 0,
      href: "/payments",
      action: "Connect Gmail",
      tourStep: "payments-zelle",
    },
    {
      id: "messages",
      title: "Send families their payment links",
      body: "On Payments, prepare the links; then send each one from the Outbox on your phone with one tap.",
      done: handSent > 0,
      href: "/payments",
      action: "Go to Payments",
      tourStep: "payments-autopay",
    },
    {
      id: "live",
      title: "Turn on real card and bank payments",
      body: "Autopay runs in Stripe's test mode until you switch to Live in Settings → Payments, once everything has been tested.",
      done: stripe.enabled && stripe.mode === "live" && !!stripe.keys.live.secret,
      href: "/settings",
      action: "Open Settings",
      tourStep: "settings",
    },
    {
      id: "tour",
      title: "Take the 3-minute tour",
      body: "What every page is for, and your weekly routine.",
      done: !!meta.tour_completed_at,
      href: "/dashboard",
      action: "Start the tour",
      tourStep: "welcome",
    },
  ];

  return { items, hidden: !!meta.checklist_hidden };
}

export interface TestResult {
  case_id: string;
  status: "pass" | "fail" | "blocked" | "na" | null;
  ticks: number[];
  notes: string;
  updated_by: string | null;
  updated_at: string;
}

export async function getTestResults(): Promise<TestResult[]> {
  const { data } = await createAdminSupabase().from("acceptance_results").select("*");
  return (data || []) as TestResult[];
}
