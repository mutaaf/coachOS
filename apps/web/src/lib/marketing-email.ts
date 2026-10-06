import { Resend } from "resend";
import { appUrl } from "@/lib/app-url";
import { isEmail, sendEmail, type SendOutcome } from "@/lib/email";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Newsletters and promotions — kept apart from receipts and reminders.
 *
 * CAN-SPAM (15 U.S.C. 7704; 16 CFR 316) for anything whose primary purpose is
 * to promote: an opt-out that works in one step and is honoured (immediately
 * here; the law allows 10 business days), the sender's postal address, and no
 * misleading subject. Gmail and Yahoo also require one-click unsubscribe
 * headers (RFC 8058) from bulk senders. And the website's contract asks for an
 * opt-in (`marketing_email` consent), which is stricter than CAN-SPAM.
 *
 * So a marketing email goes only to a parent who opted in and hasn't opted
 * out, whose address isn't on the suppression list, and only once the
 * business's mailing address is set in Settings.
 */

export type MarketingOutcome = SendOutcome | "no_consent" | "no_mailing_address" | "no_family";

/** The one-click endpoint: POST unsubscribes (RFC 8058), GET shows a confirm page. */
export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

export function unsubscribeHeaders(url: string, mailto?: string | null): Record<string, string> {
  const targets = [`<${url}>`];
  if (mailto && isEmail(mailto)) targets.push(`<mailto:${mailto.trim()}?subject=unsubscribe>`);
  return {
    "List-Unsubscribe": targets.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What every marketing email ends with: why they got it, how to stop, and where we are. */
export function marketingFooter(opts: { brand: string; address: string; url: string }): { text: string; html: string } {
  const address = opts.address.trim();
  return {
    text: `\n\n—\nYou're getting this because you asked for news from ${opts.brand}.\nUnsubscribe: ${opts.url}\n${address}`,
    html: `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#64748b;text-align:center">You're getting this because you asked for news from ${esc(opts.brand)}.<br><a href="${esc(opts.url)}" style="color:#64748b">Unsubscribe</a><br>${esc(address).replace(/\n/g, "<br>")}</p>`,
  };
}

export async function sendMarketingEmail(
  supabase: OpsClient,
  email: { parentId: string; campaign: string; subject: string; text: string; html: string },
  sender: Pick<Resend, "emails"> | null = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
): Promise<MarketingOutcome> {
  const { data: parent } = await supabase
    .from("parents")
    .select("id, email, marketing_email_consent_at, marketing_email_opt_out_at, unsubscribe_token, anonymized_at")
    .eq("id", email.parentId)
    .maybeSingle();
  if (!parent || parent.anonymized_at) return "no_family";
  if (!parent.marketing_email_consent_at || parent.marketing_email_opt_out_at) return "no_consent";

  const { data: config } = await supabase
    .from("config")
    .select("key, value")
    .in("key", ["business_mailing_address", "business_name", "email_reply_to"]);
  const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));
  const address = (c.business_mailing_address || "").trim();
  if (!address) return "no_mailing_address";

  const url = unsubscribeUrl(parent.unsubscribe_token);
  const footer = marketingFooter({ brand: c.business_name || "Rising Stars", address, url });
  const html = email.html.includes("</body>") ? email.html.replace("</body>", `${footer.html}</body>`) : email.html + footer.html;

  return sendEmail(
    supabase,
    {
      kind: "marketing",
      dedupeKey: `marketing:${email.campaign}:${parent.id}`,
      parentId: parent.id,
      to: parent.email,
      subject: email.subject,
      text: email.text + footer.text,
      html,
      headers: unsubscribeHeaders(url, c.email_reply_to),
    },
    sender
  );
}
