import { Resend } from "resend";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Email to a parent, at most once per event, never in the way of the payment.
 *
 * Every send is recorded in `emails` under a key naming the event it is about
 * ("receipt:pi_123"). A webhook redelivered, a cron re-run, two paths reporting
 * the same payment — the second insert finds the key taken and nothing goes
 * out. The same key is passed to Resend as its idempotency key, which covers
 * the one gap left: a request that reached Resend but whose reply was lost.
 *
 * This never throws. An email that fails is a row marked failed; it must not
 * turn a payment that went through into an error.
 */

/**
 * Every kind but "marketing" is transactional: about the family's own place,
 * bill or payment, sent whether or not they opted in to news (CAN-SPAM's
 * "transactional or relationship" messages). Marketing goes only through
 * sendMarketingEmail (lib/marketing-email.ts), which checks the opt-in, the
 * suppression list and the postal address, and adds the unsubscribe headers.
 */
export type EmailKind = "receipt" | "payment_failed" | "invite" | "reminder" | "registration" | "welcome" | "marketing";

export interface OutgoingEmail {
  kind: EmailKind;
  dedupeKey: string;
  parentId: string | null;
  to: string | null | undefined;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe on marketing email. */
  headers?: Record<string, string>;
}

type Sender = Pick<Resend, "emails">;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string | null | undefined): value is string {
  return !!value && EMAIL.test(value.trim());
}

/** The domain verified in Resend. Mail from any other is refused outright. */
export const SENDING_DOMAIN = "risingstars.training";

/**
 * Whether "Send Email As" is a sender Resend will accept: a name, then an
 * address at the verified domain or beneath it, `Rising Stars <payments@…>`.
 * Anything else would fail every parent email, quietly.
 */
export function isSender(value: string): boolean {
  const m = /^([^<>@]*\S)\s*<([^\s<>@]+)@([^\s<>@]+)>$/.exec(value.trim());
  if (!m) return false;
  const domain = m[3].toLowerCase();
  return domain === SENDING_DOMAIN || domain.endsWith(`.${SENDING_DOMAIN}`);
}

export type SendOutcome = "sent" | "failed" | "skipped" | "duplicate" | "no_address" | "disabled" | "suppressed";

export async function sendEmail(
  supabase: OpsClient,
  email: OutgoingEmail,
  sender: Sender | null = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
): Promise<SendOutcome> {
  try {
    if (!isEmail(email.to)) return "no_address";
    const to = email.to.trim();

    const { data: config } = await supabase
      .from("config")
      .select("key, value")
      .in("key", ["emails_enabled", "email_from", "email_reply_to"]);
    const c = Object.fromEntries((config || []).map((r) => [r.key, r.value]));
    if (c.emails_enabled !== "true") return "disabled";

    // The suppression list: a hard bounce or spam complaint stops everything;
    // an unsubscribe stops marketing only.
    const { data: suppressed } = await supabase
      .from("email_suppressions")
      .select("scope")
      .eq("email", to.toLowerCase())
      .maybeSingle();
    if (suppressed && (suppressed.scope === "all" || email.kind === "marketing")) return "suppressed";

    const { data: row } = await supabase
      .from("emails")
      .upsert(
        {
          dedupe_key: email.dedupeKey,
          kind: email.kind,
          parent_id: email.parentId,
          to_address: to,
          subject: email.subject,
          body_text: email.text,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();
    if (!row) return "duplicate";

    if (!sender) {
      await supabase
        .from("emails")
        .update({ status: "skipped", error: "Email sending isn't set up (no RESEND_API_KEY)." })
        .eq("id", row.id);
      return "skipped";
    }

    const { data, error } = await sender.emails.send(
      {
        from: c.email_from || "Rising Stars <payments@risingstars.training>",
        to,
        ...(isEmail(c.email_reply_to) ? { replyTo: c.email_reply_to.trim() } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.headers ? { headers: email.headers } : {}),
      },
      { idempotencyKey: email.dedupeKey.slice(0, 256) }
    );

    await supabase
      .from("emails")
      .update(
        error
          ? { status: "failed", error: error.message }
          : { status: "sent", provider_id: data?.id ?? null, sent_at: new Date().toISOString() }
      )
      .eq("id", row.id);
    return error ? "failed" : "sent";
  } catch (err) {
    console.error("Email failed", email.dedupeKey, err);
    return "failed";
  }
}
