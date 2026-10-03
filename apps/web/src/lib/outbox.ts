import { normalizePhone } from "@/lib/roster";

/**
 * Links that open a message, already written, in the owner's own apps.
 *
 * wa.me wants the full number as digits with no "+"; an sms: link wants it with
 * the "+". "?&body=" rather than "?body=" is deliberate: iOS reads the first
 * and Android the second, and both accept the combined form.
 */
export function whatsappLink(phone: string, text: string): string | null {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * The number as wa.me wants it. Every WhatsApp link is built from this: a US
 * number's digits without the 1 open a chat in another country.
 */
export function toWhatsAppDigits(phone: string | null | undefined): string | null {
  const e164 = normalizePhone(phone);
  return e164 ? e164.slice(1) : null;
}

export function smsLink(phone: string, text: string): string | null {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  return `sms:${e164}?&body=${encodeURIComponent(text)}`;
}
