/**
 * The emails parents get. Plain and short: a receipt someone can forward to an
 * employer or keep for taxes, and notes that say what happened and the one
 * thing to do next.
 *
 * Each returns text and HTML. The HTML lays amounts out in tables with inline
 * styles: Outlook ignores flexbox, and an amount that collapses into the
 * child's name makes a receipt unreadable. The text version is what
 * plain-text clients get, and what is stored in the `emails` log.
 */

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

function layout(brand: string, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#ea580c">${esc(brand)}</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3">${esc(title)}</h1>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;font-size:15px;line-height:1.55">${body}</div>
<p style="margin:20px 0 0;font-size:12px;color:#64748b">Questions? Just reply to this email.</p>
</div></body></html>`;
}

function row(left: string, right: string, style = "") {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;${style}">${left}</td><td align="right" style="padding:8px 0 8px 12px;border-bottom:1px solid #f1f5f9;white-space:nowrap;vertical-align:top;${style}">${right}</td></tr>`;
}

function table(rows: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

function linesHtml(lines: EmailLine[]) {
  return lines
    .map((l) =>
      row(
        `${esc(l.childName)} · ${esc(monthName(l.month))}<br><span style="color:#64748b;font-size:13px">${esc(l.programName)}</span>`,
        `<strong>${dollars(l.cents)}</strong>`
      )
    )
    .join("");
}

const linesText = (lines: EmailLine[]) =>
  lines.map((l) => `  ${l.childName}, ${monthName(l.month)} (${l.programName}): ${dollars(l.cents)}`).join("\n");

function button(href: string, label: string) {
  return `<p style="margin:20px 0 0"><a href="${esc(href)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px">${esc(label)}</a></p>`;
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
    "Payment received — thank you",
    `<p style="margin:0 0 12px">Hi ${esc(opts.parentName)}, we've received your payment.</p>
${table(
  linesHtml(opts.lines) +
    (opts.feeCents > 0 ? row("Card processing fee", dollars(opts.feeCents), "color:#64748b") : "") +
    row("<strong>Total</strong>", `<strong>${dollars(totalCents)}</strong>`, "border-bottom:0")
)}
<p style="margin:16px 0 0;color:#64748b;font-size:13px">Paid by ${esc(opts.method)} on ${esc(opts.receivedOn)}.</p>
${button(opts.payLink, "View your payment page")}`
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
${button(opts.payLink, "Update payment")}`
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
    `Pay for ${opts.childNames} automatically`,
    `<p style="margin:0">Hi ${esc(opts.parentName)}, you can now pay each month automatically — from your bank account with no fee, or by card. It takes about a minute.</p>
<p style="margin:12px 0 0">Prefer Zelle? Your page has the details, and you won't need to message us when you've sent it.</p>
${button(opts.payLink, "Set up payments")}`
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
    "A friendly payment reminder",
    `<p style="margin:0 0 12px">Hi ${esc(opts.parentName)}, this is still open:</p>
${table(linesHtml(opts.lines))}
${button(opts.payLink, "Pay now")}
<p style="margin:16px 0 0;color:#64748b;font-size:13px">If you've already sent it, thank you — please ignore this.</p>`
  );
  return { subject, text, html };
}
