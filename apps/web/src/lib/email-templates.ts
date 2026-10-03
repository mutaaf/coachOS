/**
 * The emails parents get — and they should feel like part of the team.
 *
 * Festive by default: a confetti-and-soccer-ball header on the happy ones
 * (registration, welcome, receipts), warm and calm on the one that isn't
 * (a payment that didn't go through — confetti there would read as a joke).
 *
 * The animation is a GIF (public/email/celebrate.gif, made by
 * scripts/make-email-gif.py), because Gmail and Outlook strip CSS animation;
 * a little CSS motion is layered on for Apple Mail, which honours it, and
 * everything reads the same without it. Layout is tables with inline styles —
 * Outlook ignores flexbox, and an amount that collapses into a child's name
 * makes a receipt unreadable. The text version is what plain-text clients
 * get, and what is stored in the `emails` log.
 */

import { appUrl } from "@/lib/app-url";

export interface EmailLine {
  childName: string;
  programName: string;
  month: string; // YYYY-MM
  cents: number;
}

export const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ORANGE = "#ea580c";
const INK = "#0f172a";
const MUTED = "#64748b";

type Tone = "party" | "warm";

function layout(
  brand: string,
  title: string,
  body: string,
  opts: { tone?: Tone; preheader?: string; kicker?: string } = {}
) {
  const tone = opts.tone ?? "party";
  const header =
    tone === "party"
      ? `<tr><td style="padding:0;line-height:0"><img src="${appUrl()}/email/celebrate.gif" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:20px 20px 0 0"></td></tr>`
      : `<tr><td style="height:10px;background:${ORANGE};border-radius:20px 20px 0 0;line-height:10px;font-size:0">&nbsp;</td></tr>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<style>
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&display=swap');
.cs-title{font-family:'Fredoka','Trebuchet MS',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
@keyframes cs-pop{0%{transform:scale(.9);opacity:0}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@keyframes cs-nudge{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.cs-title{animation:cs-pop .6s ease-out both}
.cs-btn{animation:cs-nudge 2.4s ease-in-out 1.2s infinite}
@media (prefers-reduced-motion:reduce){.cs-title,.cs-btn{animation:none}}
</style></head>
<body style="margin:0;padding:0;background:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader ?? title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;box-shadow:0 2px 0 #fed7aa">
${header}
<tr><td style="padding:24px 28px 8px">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${ORANGE}">${esc(opts.kicker ?? brand)}</p>
<h1 class="cs-title" style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${INK}">${esc(title)}</h1>
</td></tr>
<tr><td style="padding:12px 28px 28px;font-size:16px;line-height:1.6">${body}</td></tr>
</table>
<p style="margin:18px 0 0;font-size:13px;color:${MUTED}">⚽ ${esc(brand)} · Questions? Just reply — a real person reads every one.</p>
</td></tr></table>
</body></html>`;
}

function row(left: string, right: string, style = "") {
  return `<tr><td style="padding:10px 0;border-bottom:1px dashed #fed7aa;${style}">${left}</td><td align="right" style="padding:10px 0 10px 12px;border-bottom:1px dashed #fed7aa;white-space:nowrap;vertical-align:top;${style}">${right}</td></tr>`;
}

function table(rows: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0">${rows}</table>`;
}

function linesHtml(lines: EmailLine[]) {
  return lines
    .map((l) =>
      row(
        `${esc(l.childName)} · ${esc(monthName(l.month))}<br><span style="color:${MUTED};font-size:13px">${esc(l.programName)}</span>`,
        `<strong>${dollars(l.cents)}</strong>`
      )
    )
    .join("");
}

const linesText = (lines: EmailLine[]) =>
  lines.map((l) => `  ${l.childName}, ${monthName(l.month)} (${l.programName}): ${dollars(l.cents)}`).join("\n");

function button(href: string, label: string, color = ORANGE) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td class="cs-btn" style="border-radius:999px;background:${color}"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;border-radius:999px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px">${label}</a></td></tr></table>`;
}

function whatsappButton(href: string) {
  return button(href, "💬 Join the team group chat", "#25D366");
}

/** A short checklist, each item with its own little icon. */
function checklist(items: [string, string][]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0">${items
    .map(
      ([icon, text]) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-size:20px;line-height:1.3">${icon}</td><td style="padding:6px 0;vertical-align:top">${text}</td></tr>`
    )
    .join("")}</table>`;
}

function details(pairs: [string, string | null | undefined][]) {
  const shown = pairs.filter(([, v]) => v);
  if (!shown.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;background:#fff7ed;border-radius:14px"><tr><td style="padding:6px 18px">${table(
    shown.map(([k, v], i) => row(`<span style="color:${MUTED}">${esc(k)}</span>`, `<strong>${esc(v!)}</strong>`, i === shown.length - 1 ? "border-bottom:0" : "")).join("")
  )}</td></tr></table>`;
}

export function receiptEmail(opts: {
  brand: string;
  parentName: string;
  lines: EmailLine[];
  feeCents: number;
  method: string;
  receivedOn: string;
  payLink: string;
}) {
  const totalCents = opts.lines.reduce((s, l) => s + l.cents, 0) + opts.feeCents;
  const subject = `Receipt: ${dollars(totalCents)} received — ${opts.brand}`;
  const feeText = opts.feeCents > 0 ? `\n  Card processing fee: ${dollars(opts.feeCents)}` : "";
  const text = `Hi ${opts.parentName},

Thank you — we've received your payment.

${linesText(opts.lines)}${feeText}
  Total: ${dollars(totalCents)}

Paid by ${opts.method} on ${opts.receivedOn}.

Your payment page: ${opts.payLink}

${opts.brand}`;
  const html = layout(
    opts.brand,
    "Got it — thank you! 🙌",
    `<p style="margin:0 0 12px">Hi ${esc(opts.parentName)}, we've received your payment.</p>
${table(
  linesHtml(opts.lines) +
    (opts.feeCents > 0 ? row("Card processing fee", dollars(opts.feeCents), "color:#64748b") : "") +
    row("<strong>Total</strong>", `<strong>${dollars(totalCents)}</strong>`, "border-bottom:0")
)}
<p style="margin:16px 0 0;color:#64748b;font-size:13px">Paid by ${esc(opts.method)} on ${esc(opts.receivedOn)}.</p>
${button(opts.payLink, "View your payment page")}`,
    { preheader: `${dollars(totalCents)} received. Thank you for being part of the team!` }
  );
  return { subject, text, html };
}

export function paymentFailedEmail(opts: {
  brand: string;
  parentName: string;
  childNames: string;
  owedCents: number;
  reason: string;
  payLink: string;
}) {
  const subject = `Your automatic payment didn't go through — ${opts.brand}`;
  const text = `Hi ${opts.parentName},

The automatic payment of ${dollars(opts.owedCents)} for ${opts.childNames} didn't go through (${opts.reason}).

You can update your card or bank account, or pay another way, here:
${opts.payLink}

${opts.brand}`;
  const html = layout(
    opts.brand,
    "Your automatic payment didn't go through",
    `<p style="margin:0">Hi ${esc(opts.parentName)}, the automatic payment of <strong>${dollars(opts.owedCents)}</strong> for ${esc(opts.childNames)} didn't go through (${esc(opts.reason)}).</p>
<p style="margin:12px 0 0">You can update your card or bank account, or pay another way, from your payment page.</p>
${button(opts.payLink, "Update payment")}`,
    { tone: "warm", preheader: "Nothing to worry about — it takes a minute to fix." }
  );
  return { subject, text, html };
}

export function inviteEmail(opts: {
  brand: string; parentName: string; childNames: string; payLink: string }) {
  const subject = `Pay for ${opts.childNames} automatically — ${opts.brand}`;
  const text = `Hi ${opts.parentName},

You can now pay for ${opts.childNames} automatically each month — from your bank account (no fee) or by card. It takes a minute:
${opts.payLink}

Prefer Zelle? The page has the details, and you won't need to message us when you've sent it.

${opts.brand}`;
  const html = layout(
    opts.brand,
    `Set it and forget it ⚽`,
    `<p style="margin:0">Hi ${esc(opts.parentName)}, you can now pay each month automatically — from your bank account with no fee, or by card. It takes about a minute.</p>
<p style="margin:12px 0 0">Prefer Zelle? Your page has the details, and you won't need to message us when you've sent it.</p>
${button(opts.payLink, "Set up payments")}`,
    { preheader: `Pay for ${opts.childNames} automatically — no more reminders.` }
  );
  return { subject, text, html };
}

export function reminderEmail(opts: {
  brand: string; parentName: string; lines: EmailLine[]; payLink: string }) {
  const totalCents = opts.lines.reduce((s, l) => s + l.cents, 0);
  const subject = `Payment reminder: ${dollars(totalCents)} — ${opts.brand}`;
  const text = `Hi ${opts.parentName},

A friendly reminder that this is still open:

${linesText(opts.lines)}

You can pay here: ${opts.payLink}

If you've already sent it, thank you — please ignore this.

${opts.brand}`;
  const html = layout(
    opts.brand,
    "A friendly nudge from the sideline 📣",
    `<p style="margin:0 0 12px">Hi ${esc(opts.parentName)}, this is still open:</p>
${table(linesHtml(opts.lines))}
${button(opts.payLink, "Pay now")}
<p style="margin:16px 0 0;color:#64748b;font-size:13px">If you've already sent it, thank you — please ignore this.</p>`,
    { tone: "warm", preheader: `${dollars(totalCents)} is still open — here's the quick way to pay.` }
  );
  return { subject, text, html };
}

export interface ProgramDetails {
  programName: string;
  schoolName: string | null;
  /** "Tuesdays, 3:30–4:30 PM at Field B" */
  schedule: string | null;
  /** "Tuesday, October 6" */
  firstPractice: string | null;
  monthlyFeeCents: number | null;
  whatsappUrl: string | null;
}

const whatsappLine = (url: string | null) =>
  url
    ? "Join the team group chat for updates, photos and game-day news: " + url
    : "We'll send updates by email and text.";

/** Right after a parent signs up: a place held, or a place in line. */
export function registrationEmail(
  opts: ProgramDetails & {
    brand: string;
    parentName: string;
    childName: string;
    status: "confirmed" | "waitlisted";
    waitlistPosition: number | null;
  }
) {
  const fee = opts.monthlyFeeCents ? `${dollars(opts.monthlyFeeCents)} a month` : null;
  if (opts.status === "waitlisted") {
    const subject = `${opts.childName} is on the list for ${opts.programName} ⚽`;
    const text = `Hi ${opts.parentName},

${opts.programName} is full right now, so ${opts.childName} is on the waitlist${opts.waitlistPosition ? ` — number ${opts.waitlistPosition} in line` : ""}.

The moment a spot opens, you'll hear from us first. Nothing is owed unless a spot comes free.

${opts.brand}`;
    const html = layout(
      opts.brand,
      `${opts.childName} is on the list!`,
      `<p style="margin:0">Hi ${esc(opts.parentName)}, ${esc(opts.programName)} is full right now — so we've saved ${esc(opts.childName)} a place in line.</p>
${details([["Program", opts.programName], ["School", opts.schoolName], ["Place in line", opts.waitlistPosition ? `#${opts.waitlistPosition}` : null]])}
<p style="margin:12px 0 0">The moment a spot opens, you'll hear from us first. Nothing is owed unless a spot comes free. 🤞</p>`,
      { tone: "warm", preheader: `You're on the waitlist${opts.waitlistPosition ? ` — #${opts.waitlistPosition} in line` : ""}.` }
    );
    return { subject, text, html };
  }

  const subject = `🎉 ${opts.childName} is in! Welcome to ${opts.programName}`;
  const text = `Hi ${opts.parentName},

Woohoo — ${opts.childName} has a spot in ${opts.programName}!

${[["School", opts.schoolName], ["When", opts.schedule], ["First practice", opts.firstPractice], ["Fee", fee]]
  .filter(([, v]) => v)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

What's next:
  - ${whatsappLine(opts.whatsappUrl)}
  - We'll send your payment link before the first practice.
  - Bring water, shin guards and sneakers (cleats if you have them).

See you on the field!
${opts.brand}`;
  const html = layout(
    opts.brand,
    `${opts.childName} is in! 🎉`,
    `<p style="margin:0">Woohoo, ${esc(opts.parentName)}! ${esc(opts.childName)} has a spot in <strong>${esc(opts.programName)}</strong>. We can't wait to see them on the field.</p>
${details([["School", opts.schoolName], ["When", opts.schedule], ["First practice", opts.firstPractice], ["Fee", fee]])}
${opts.whatsappUrl ? whatsappButton(opts.whatsappUrl) : ""}
<p style="margin:22px 0 4px;font-weight:700">What's next</p>
${checklist([
  ...(opts.whatsappUrl ? [["💬", "Join the group chat — schedule changes, photos and game-day news land there first."] as [string, string]] : [["📬", "Watch your inbox — schedule changes and news come by email and text."] as [string, string]]),
  ["💳", "We'll send your payment link before the first practice."],
  ["🎒", "Bring water, shin guards and sneakers (cleats if you have them)."],
])}`,
    { preheader: `${opts.childName} has a spot in ${opts.programName}. Here's what happens next.` }
  );
  return { subject, text, html };
}

/** When a child is on the roster: everything for the first practice. */
export function welcomeEmail(
  opts: ProgramDetails & { brand: string; parentName: string; childName: string; payLink: string }
) {
  const fee = opts.monthlyFeeCents ? `${dollars(opts.monthlyFeeCents)} a month` : null;
  const subject = `Welcome to the team, ${opts.childName}! ⭐`;
  const text = `Hi ${opts.parentName},

${opts.childName} is officially on the ${opts.programName} roster. Welcome to the team!

${[["School", opts.schoolName], ["When", opts.schedule], ["First practice", opts.firstPractice], ["Fee", fee]]
  .filter(([, v]) => v)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

${whatsappLine(opts.whatsappUrl)}

Your payment page (autopay by bank has no fee): ${opts.payLink}

See you on the field!
${opts.brand}`;
  const html = layout(
    opts.brand,
    `Welcome to the team, ${opts.childName}! ⭐`,
    `<p style="margin:0">Hi ${esc(opts.parentName)}, ${esc(opts.childName)} is officially on the <strong>${esc(opts.programName)}</strong> roster. Here's everything for the first practice.</p>
${details([["School", opts.schoolName], ["When", opts.schedule], ["First practice", opts.firstPractice], ["Fee", fee]])}
${opts.whatsappUrl ? whatsappButton(opts.whatsappUrl) : ""}
${button(opts.payLink, "💳 Set up payments")}
<p style="margin:22px 0 4px;font-weight:700">Game-day checklist</p>
${checklist([
  ["💧", "A full water bottle"],
  ["🦵", "Shin guards (required)"],
  ["👟", "Sneakers or cleats"],
  ["😄", "A big smile — first practices are all about fun"],
])}`,
    { preheader: `${opts.childName} is on the roster! First practice details inside.` }
  );
  return { subject, text, html };
}
