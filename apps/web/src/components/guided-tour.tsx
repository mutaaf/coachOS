"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { TourContext } from "@/lib/actions/onboarding";

/**
 * A walk through CoachOS for the owner's first login, one spotlight at a time.
 *
 * Each step names a page and an element on it. The tour navigates there, waits
 * for the element, scrolls it into view, dims everything else and explains it.
 * On a phone the explanation sits along the bottom of the screen rather than
 * beside the element, so it never covers what it is talking about.
 *
 * It starts by itself the first time she signs in, and can be replayed from the
 * menu or from any "Show me" on the getting-started list. Finishing or skipping
 * records it on her account, so it doesn't start again on another device.
 */

interface Step {
  id: string;
  path: string;
  /** A CSS selector; null for a step with nothing to point at. */
  target: string | null;
  title: string;
  body: React.ReactNode;
}

/** The steps, with the addresses from Settings written in. */
function buildSteps(ctx: TourContext | null): Step[] {
  const inbox = ctx?.zelleInbox || "the Gmail in Settings";
  const forwardFrom = ctx?.zelleForwardFrom;
  return [
  {
    id: "welcome",
    path: "/dashboard",
    target: null,
    title: "Welcome to CoachOS 👋",
    body: (
      <>
        This is where {ctx?.businessName ? `${ctx.businessName}'s` : "your"} schools, families, payments and messages live — so the monthly WhatsApp posts, chasing
        payments and matching Zelle by hand can stop. This tour takes about three minutes. You can replay it any time
        from <strong>Take the tour</strong> in the menu.
      </>
    ),
  },
  {
    id: "checklist",
    path: "/dashboard",
    target: '[data-tour="getting-started"]',
    title: "Your getting-started list",
    body: (
      <>
        Six things to get fully set up. Each ticks itself off when it&apos;s really done, and{" "}
        <strong>Show me</strong> brings you back to the right part of this tour.
      </>
    ),
  },
  {
    id: "dashboard-stats",
    path: "/dashboard",
    target: '[data-tour="dashboard-stats"]',
    title: "Today at a glance",
    body: "Active students, money in this month, how many payments are overdue and what they add up to, and the practices coming up. Below are today's practices and anything that needs you — tap See all to open every overdue payment.",
  },
  {
    id: "programs",
    path: "/programs",
    target: '[data-tour="programs-tabs"]',
    title: "Programs, sessions and seasons",
    body: "Make each program once — its name, ages and usual fee — then put it on at a school as a session. Practices are a session's dates, and a season groups everything running that term.",
  },
  {
    id: "schools-import",
    path: "/schools",
    target: '[data-tour="import-roster"]',
    title: "Start here: import a roster",
    body: (
      <>
        One session at a time. Pick the school and session (or type new ones and the monthly fee), then add a{" "}
        <strong>screenshot</strong> — the WhatsApp group&apos;s member list, your spreadsheet, a sign-up sheet — or a
        CSV. You check every child before anything is saved, and importing the same list twice never makes duplicates
        — or puts back a child you withdrew, unless you tick them.
      </>
    ),
  },
  {
    id: "schools",
    path: "/schools",
    target: "main h1",
    title: "Schools and sessions",
    body: "Each school holds its sessions. Open a school to change a session's monthly fee (0 makes it free, with no invoices), set its weekly practice time, import more children, or share its registration link. Archiving a school stops its invoices, and can end its children's places too.",
  },
  {
    id: "students",
    path: "/students",
    target: "main h1",
    title: "Students and parents",
    body: "Every child and the parents linked to them. Fix a phone number here — however it's typed, it's saved as one number, so WhatsApp opens the right chat — add a parent, or move a child between sessions. Siblings share one parent, so a family gets one link and one charge. Adding someone already on file asks \"Is this the same Mia?\" first, so nobody is added twice. A child who has left can be archived: off the list, with every payment kept.",
  },
  {
    id: "families",
    path: "/students",
    target: '[data-tour="student-tabs"]',
    title: "What does a family owe?",
    body: (
      <>
        <strong>Parents</strong> shows each family&apos;s <strong>Balance</strong> — what they still owe, for every
        child. Tap a parent&apos;s or child&apos;s name to open their family: the children and where they play, both
        parents, each invoice and what&apos;s left on it, the messages you&apos;ve sent them, and their payment link to
        copy.
      </>
    ),
  },
  {
    id: "registrations",
    path: "/registrations",
    target: "main h1",
    title: "Registrations",
    body: "New sign-ups from a session's public link. Share the link in a WhatsApp group; parents register themselves, full sessions fill a waitlist, and you add each confirmed child to the roster with one tap — which also makes their first bill. A family already on file is used, not copied — their medical notes go onto the child you already have. Each sign-up, and each family given a place that opens, gets a message waiting in your Outbox. When a place opens, it goes to the next in line; cancelling asks first, can take the child off the roster, and can be undone with Restore.",
  },
  {
    id: "schedule",
    path: "/schedule",
    target: "main h1",
    title: "Schedule and attendance",
    body: "Your practices by week. Take attendance here — Save & complete saves the register and marks the practice done — or send a coach a link and passcode so they can do it on their phone at the gym. A completed practice keeps its register, so you can check it and fix a mistake. The link works until a few hours after the practice ends, and cancelling the practice turns it off and writes a message to every family on its roster — it waits in your Outbox to send. Pick who ran each practice under Coach — that's what their pay counts. Changing a weekly time or coach in Manage Templates moves the practices already on the calendar too.",
  },
  {
    id: "payments-autopay",
    path: "/payments",
    target: '[data-tour="autopay"]',
    title: "Autopay",
    body: (
      <>
        <strong>Send payment links</strong> prepares a message for each family with their own payment page. From
        there they can pay automatically by bank (no fee) or card (with the card fee). Once they do, they&apos;re
        charged on the due day each month, they get a receipt, and there&apos;s nothing for you to chase. Families with two
        children get one charge.
      </>
    ),
  },
  {
    id: "payments-zelle",
    path: "/payments",
    target: '[data-tour="zelle"]',
    title: "Zelle, recorded for you",
    body: (
      <>
        After the one-time <strong>Connect Gmail</strong> setup (on a computer),{" "}
        {forwardFrom ? (
          <>
            forward each Zelle alert from {forwardFrom} to {inbox}
          </>
        ) : (
          <>Zelle alerts arriving at {inbox} are read automatically</>
        )}
        . Within 15 minutes each is matched to the family and marked paid. If CoachOS isn&apos;t sure who sent it,
        it waits here — pick the family once and it remembers them next time.
      </>
    ),
  },
  {
    id: "record-payment",
    path: "/payments",
    target: '[data-tour="record-payment"]',
    title: "Money from someone new",
    body: (
      <>
        Cash, Venmo, or a Zelle from someone not set up yet? <strong>Record Payment</strong> (top right) (or{" "}
        <strong>Who paid this?</strong> on a Zelle) asks who paid — and if they&apos;re new, adds the family, child,
        school and session as you go, then records the money. It shows you everything before saving. Paid ahead, or
        more than they owe? The extra is kept as their <strong>credit</strong> and pays their next invoice by itself.
      </>
    ),
  },
  {
    id: "payments-invoices",
    path: "/payments",
    target: '[data-tour="invoice-statuses"]',
    title: "Invoices and what each status means",
    body: (
      <>
        <strong>Pending</strong>: not due yet. <strong>Processing</strong>: a bank payment is on its way — nothing to
        do. <strong>Overdue</strong>: past due; a reminder goes out once, automatically. <strong>Paid</strong> and{" "}
        <strong>Waived</strong> are done. <strong>Balance</strong> is what&apos;s left to pay after any part
        payments. The link icon on each row copies that family&apos;s payment page; tap the parent&apos;s name to see
        the whole family.
      </>
    ),
  },
  {
    id: "payments-generate",
    path: "/payments",
    target: '[data-tour="generate-invoices"]',
    title: "Monthly invoices make themselves",
    body: "Every family is invoiced on the 1st automatically, due on the Payment Due Day in Settings. Use this only to bill a month early, or to catch up a child who joined after the 1st — they get a week to pay. Free sessions, finished or cancelled ones, months outside a session's dates and archived schools are never invoiced.",
  },
  {
    id: "outbox",
    path: "/messaging?tab=outbox",
    target: '[data-tour="outbox"]',
    title: "The Outbox — your one daily habit",
    body: (
      <>
        Payment links, reminders and failed-payment notes wait here. Tap <strong>WhatsApp</strong> next to a family:
        WhatsApp opens with the message already written to them — press send, come back, tap the next. Families
        with an email also get receipts and notices by email automatically.
      </>
    ),
  },
  {
    id: "messaging-tabs",
    path: "/messaging",
    target: '[data-tour="messaging-tabs"]',
    title: "Compose, templates and history",
    body: "Compose writes one message to a whole school or session (it lands in the Outbox to send) — pick the school or session, then check the names shown before you send. Templates are the wording of every automatic message — change them freely. History shows what went out.",
  },
  {
    id: "website",
    path: "/website",
    target: '[data-tour="website-tabs"]',
    title: "Your website, from here",
    body: (
      <>
        The programs, testimonials and partnerships on risingstars.training. Add a program straight from one in
        CoachOS and the site shows live open places, with sign-ups landing here. Anything ended or not linked is
        flagged under <strong>Needs a look</strong>.
      </>
    ),
  },
  {
    id: "settings",
    path: "/settings",
    target: '[data-tour="settings-tabs"]',
    title: "Settings",
    body: "Every address, number and key lives here — the day invoices are due, the fee a new session starts with, your Zelle details, the Gmail that reads Zelle alerts, who emails come from and where replies go, the business name parents see, the card fee and the switch for real card payments. Each has a Copy button, and a change takes effect as soon as you save.",
  },
  {
    id: "access",
    path: "/settings",
    target: '[data-tour="access-tab"]',
    title: "Who can sign in",
    body: (
      <>
        Everyone has their own login. Invite someone from <strong>Access</strong> — they get an email to choose a
        password — or take access away. Nobody can make their own account.
      </>
    ),
  },
  {
    id: "help",
    path: "/help",
    target: '[data-tour="help-tabs"]',
    title: "Help, whenever you need it",
    body: (
      <>
        Step-by-step guides for everything you do, each with <strong>Show me</strong> to walk you there;{" "}
        <strong>Practise</strong> for trying things safely in test mode; and the <strong>Test plan</strong> — every check,
        with your results saved as you go.
      </>
    ),
  },
  {
    id: "routine",
    path: "/dashboard",
    target: null,
    title: "Your routine from here",
    body: (
      <ol className="list-decimal space-y-1 pl-5">
        {forwardFrom && (
          <li>
            <strong>When a Zelle alert lands in {forwardFrom}</strong>, forward it to {inbox}.
          </li>
        )}
        <li>
          <strong>Once a day or so</strong>, open Messaging → Outbox and send what&apos;s there.
        </li>
        <li>
          <strong>Now and then</strong>, check Payments → Zelle for anything waiting on you.
        </li>
      </ol>
    ),
  },
  ];
}

export const TOUR_EVENT = "coachos:tour";

/** Start the tour from anywhere, optionally at a given step. */
/**
 * Start the tour: from the beginning, at one stop (then onward), or — given a
 * list — through just those stops, as "What's new" does for a release.
 */
export function startTour(stepId?: string | string[]) {
  const detail = Array.isArray(stepId) ? { only: stepId } : { step: stepId };
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail }));
}

/** Every stop's id, for checking that release notes point at real ones. */
export function tourStepIds(): string[] {
  return buildSteps(null).map((s) => s.id);
}

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findTarget(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll(selector))) if (visible(el)) return el;
  return null;
}

export function GuidedTour({ autoStart, ctx }: { autoStart: boolean; ctx: TourContext | null }) {
  const ALL = useMemo(() => buildSteps(ctx), [ctx]);
  const [only, setOnly] = useState<string[] | null>(null);
  const STEPS = useMemo(() => (only ? ALL.filter((s) => only.includes(s.id)) : ALL), [ALL, only]);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = index === null ? null : STEPS[index];

  const finish = useCallback(async () => {
    setIndex(null);
    setRect(null);
    setOnly(null);
    // On the account, not the browser, so it doesn't start again on her phone
    // after she has done it on a laptop.
    await createClient().auth.updateUser({ data: { tour_completed_at: new Date().toISOString() } });
    router.refresh();
  }, [router]);

  // Started from the menu or a "Show me".
  useEffect(() => {
    function onStart(e: Event) {
      const detail = (e as CustomEvent).detail ?? {};
      if (Array.isArray(detail.only)) {
        const known = (detail.only as string[]).filter((id) => ALL.some((s) => s.id === id));
        if (known.length === 0) return;
        setOnly(known);
        setIndex(0);
        return;
      }
      setOnly(null);
      const at = detail.step ? ALL.findIndex((s) => s.id === detail.step) : 0;
      setIndex(at >= 0 ? at : 0);
    }
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  useEffect(() => {
    if (autoStart) setIndex(0);
  }, [autoStart]);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Go to the step's page, then wait for its element to appear.
  useEffect(() => {
    if (!step) return;
    // A path may carry a tab ("/messaging?tab=outbox"); being on the page with
    // another tab open still means going there.
    const [base, query] = step.path.split("?");
    if (pathname !== base || (query && search !== query)) {
      setWaiting(true);
      setRect(null);
      router.push(step.path);
      return;
    }
    if (!step.target) {
      setWaiting(false);
      setRect(null);
      return;
    }
    let cancelled = false;
    const started = Date.now();
    setWaiting(true);
    (function poll() {
      if (cancelled) return;
      const el = findTarget(step.target!);
      if (el) {
        // On a phone the card sits at the bottom, so bring the element to the
        // top, clear of the menu bar; on a wide screen, the middle.
        const isNarrow = window.innerWidth < 1024;
        el.scrollIntoView({ block: isNarrow ? "start" : "center", behavior: "instant" as ScrollBehavior });
        if (isNarrow) document.querySelector("main")?.scrollBy(0, -16);
        setRect(el.getBoundingClientRect());
        setWaiting(false);
      } else if (Date.now() - started > 4000) {
        // Nothing to point at (an empty page, a narrow screen): explain anyway.
        setRect(null);
        setWaiting(false);
      } else {
        setTimeout(poll, 100);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, pathname, search, router]);

  // Keep the spotlight on its element through scrolling and resizing.
  useEffect(() => {
    if (!step?.target || waiting) return;
    const update = () => {
      const el = findTarget(step.target!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step, waiting]);

  useEffect(() => {
    if (index === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : Math.min(i + 1, STEPS.length - 1)));
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  // Where the card goes, and how much of the element the spotlight shows.
  //
  // On a wide screen the card goes wherever there is room — below, above, then
  // beside. An element taller than the screen (a long list) leaves room
  // nowhere, so the card docks in the corner and the spotlight stops short of
  // it. On a phone the card is always docked at the bottom, and the spotlight
  // is trimmed the same way. Either way the card never covers what it explains.
  const [layout, setLayout] = useState<{
    spot: { top: number; left: number; width: number; height: number };
    card: { top: number; left: number } | null;
  } | null>(null);

  useLayoutEffect(() => {
    if (!rect || !cardRef.current) {
      setLayout(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const card = cardRef.current.getBoundingClientRect();
    const pad = 8;
    const gap = 14;
    const edge = 12;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

    const box = {
      top: Math.max(rect.top - pad, edge),
      left: Math.max(rect.left - pad, edge),
      right: Math.min(rect.right + pad, vw - edge),
      bottom: Math.min(rect.bottom + pad, vh - edge),
    };
    let cardAt: { top: number; left: number } | null = null;

    if (narrow) {
      // Docked along the bottom, clear of the home bar — unless the element
      // sits so low that the card would cover it (the last thing on a page
      // that can't scroll any further); then the card docks at the top and
      // the spotlight starts below it.
      const insets = getComputedStyle(document.documentElement);
      const sab = parseFloat(insets.getPropertyValue("--safe-bottom")) || 0;
      const sat = parseFloat(insets.getPropertyValue("--safe-top")) || 0;
      const bottomDock = vh - edge - sab - card.height;
      const enough = Math.min(rect.height + pad * 2, 64);
      if (box.top + enough <= bottomDock - gap) {
        cardAt = { top: bottomDock, left: edge };
        box.bottom = Math.min(box.bottom, bottomDock - gap);
      } else {
        const topDock = edge + sat;
        cardAt = { top: topDock, left: edge };
        box.top = Math.max(box.top, topDock + card.height + gap);
        box.bottom = Math.max(box.bottom, box.top + 24);
      }
    } else if (box.bottom + gap + card.height <= vh - edge) {
      cardAt = { top: box.bottom + gap, left: clamp(box.left, edge, vw - card.width - edge) };
    } else if (box.top - gap - card.height >= edge) {
      cardAt = { top: box.top - gap - card.height, left: clamp(box.left, edge, vw - card.width - edge) };
    } else if (box.right + gap + card.width <= vw - edge) {
      cardAt = { top: clamp(box.top, edge, vh - card.height - edge), left: box.right + gap };
    } else if (box.left - gap - card.width >= edge) {
      cardAt = { top: clamp(box.top, edge, vh - card.height - edge), left: box.left - gap - card.width };
    } else {
      cardAt = { top: vh - card.height - edge, left: vw - card.width - edge };
      box.bottom = Math.min(box.bottom, cardAt.top - gap);
    }

    setLayout({
      spot: {
        top: box.top,
        left: box.left,
        width: box.right - box.left,
        height: Math.max(box.bottom - box.top, 24),
      },
      card: cardAt,
    });
  }, [rect, narrow, index]);

  if (!step) return null;
  const last = index === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Dim everything; a spotlight when there is something to point at. */}
      {rect && layout && !waiting ? (
        <div
          data-testid="tour-spotlight"
          className="pointer-events-none fixed rounded-xl"
          style={{
            ...layout.spot,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)",
            outline: "2px solid rgba(255,255,255,0.9)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/60" />
      )}

      <div
        ref={cardRef}
        className={
          // On a short phone the card is capped and its text scrolls, so the
          // element it explains always keeps some of the screen.
          "flex max-h-[min(65dvh,32rem)] flex-col rounded-2xl bg-white p-4 shadow-2xl sm:p-5 " +
          (narrow || !rect
            ? `fixed inset-x-3 ${rect ? "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2"}`
            : "fixed w-[380px]")
        }
        style={
          rect && layout?.card
            ? narrow
              ? { top: layout.card.top, bottom: "auto" }
              : layout.card
            : undefined
        }
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
            {index! + 1} of {STEPS.length}
          </p>
          <button
            type="button"
            onClick={finish}
            aria-label="Close the tour"
            className="-m-2.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold text-slate-900">
          {step.title}
        </h2>
        <div className="-mr-2 mt-2 min-h-0 overflow-y-auto overscroll-contain pr-2 text-sm leading-relaxed text-slate-600">
          {step.body}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-between gap-2">
          <button type="button" onClick={finish} className="-ml-2 h-10 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700">
            {last ? "" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            {index! > 0 && (
              <Button variant="outline" size="sm" className="h-11 sm:h-10" onClick={() => setIndex(index! - 1)}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              className="h-11 min-w-[5rem] sm:h-10"
              disabled={waiting}
              onClick={() => (last ? finish() : setIndex(index! + 1))}
            >
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-4 flex shrink-0 gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.id} className={`h-1 flex-1 rounded-full ${i <= index! ? "bg-orange-500" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
