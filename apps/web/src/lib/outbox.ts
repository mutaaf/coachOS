import { normalizePhone } from "@/lib/roster";

/**
 * Links that open a message, already written, in the owner's own apps.
 *
 * wa.me wants the full number as digits with no "+"; an sms: link wants it with
 * the "+". "?&body=" rather than "?body=" is deliberate: iOS reads the first
 * and Android the second, and both accept the combined form.
 */
export function whatsappLink(phone: string, text: string): string | null {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text)}`;
}

export function smsLink(phone: string, text: string): string | null {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  return `sms:${e164}?&body=${encodeURIComponent(text)}`;
}
