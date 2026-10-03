import { Resend } from "resend";
import type { OpsClient } from "@/lib/supabase/types";
import { appUrl } from "@/lib/app-url";

/**
 * Email to the people who run CoachOS (not parents): an invite, a password
 * link. Sent straight through Resend — these aren't family records, so they
 * stay out of the parents' email log. Returns whether it went.
 */
export async function sendStaffEmail(
  supabase: OpsClient,
  opts: { to: string; subject: string; heading: string; body: string; button: { href: string; label: string }; text: string }
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const { data } = await supabase.from("config").select("key, value").in("key", ["email_from", "business_name"]);
  const c = Object.fromEntries((data || []).map((r) => [r.key, (r.value as string)?.trim()]));
  const brand = c.business_name || "Rising Stars Youth Academy";
  const from = c.email_from || `${brand} <hello@send.risingstars.training>`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html><body style="margin:0;background:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:20px;box-shadow:0 2px 0 #fed7aa">
<tr><td style="line-height:0"><img src="${appUrl()}/email/celebrate.gif" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border-radius:20px 20px 0 0"></td></tr>
<tr><td style="padding:24px 28px 28px;font-size:16px;line-height:1.6">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ea580c">${esc(brand)} · CoachOS</p>
<h1 style="margin:0 0 12px;font-size:26px;line-height:1.25">${esc(opts.heading)}</h1>
<p style="margin:0">${esc(opts.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td style="border-radius:999px;background:#ea580c"><a href="${esc(opts.button.href)}" style="display:inline-block;padding:14px 26px;color:#fff;text-decoration:none;font-weight:700">${esc(opts.button.label)}</a></td></tr></table>
<p style="margin:18px 0 0;font-size:13px;color:#64748b">The link works once and expires in 24 hours. Didn't expect this? Ignore it — nothing happens.</p>
</td></tr></table></td></tr></table></body></html>`;
  const { error } = await new Resend(key).emails.send({ from, to: opts.to, subject: opts.subject, html, text: opts.text });
  return !error;
}
