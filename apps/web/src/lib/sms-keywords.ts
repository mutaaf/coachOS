/**
 * What a parent's reply text means, for consent.
 *
 * CoachOS has no SMS provider today: every text goes out by hand from the
 * owner's phone, and replies land on her phone, not here. So these keywords
 * are recorded by hand ("They said STOP" on the family page). This module is
 * the rule for when an inbound SMS/WhatsApp webhook is added: any of the
 * opt-out words, alone or with punctuation, revokes consent (47 CFR
 * 64.1200(a)(10) names STOP, QUIT, END, REVOKE, OPT OUT, CANCEL and
 * UNSUBSCRIBE as reasonable means, and says other reasonable means count too),
 * and must be honoured within 10 business days — we do it immediately.
 * HELP gets the business's name and how to reach a person; START re-opts in.
 *
 * Reply texts (sent once, then nothing more until they opt back in):
 */

export type SmsKeyword = "opt_out" | "help" | "opt_in" | null;

const OPT_OUT = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT", "OPT-OUT"];
const HELP = ["HELP", "INFO"];
const OPT_IN = ["START", "UNSTOP", "YES", "SUBSCRIBE"];

/** Normalise a reply: case, surrounding punctuation and spacing don't change its meaning. */
function normalise(body: string): string {
  return body
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySmsReply(body: string | null | undefined): SmsKeyword {
  const text = normalise(body ?? "");
  if (!text) return null;
  if (OPT_OUT.includes(text)) return "opt_out";
  if (HELP.includes(text)) return "help";
  if (OPT_IN.includes(text)) return "opt_in";
  return null;
}

export function optOutConfirmation(brand: string): string {
  return `${brand}: you won't get any more texts from us. Reply START to opt back in.`;
}

export function helpReply(brand: string, contact: string): string {
  return `${brand}: program updates for your family. Reach us at ${contact}. Reply STOP to stop texts. Msg & data rates may apply.`;
}
