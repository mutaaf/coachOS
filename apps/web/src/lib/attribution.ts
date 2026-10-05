import type { Attribution, AttributionTouch } from "@/types/database";

/**
 * Where a family came from, in a few words for a list: "google / cpc ·
 * fall-promo". The website records the first visit that brought them and the
 * last one before they signed up; the last says what finally worked, so it
 * leads, falling back to the first. Null when nothing was recorded (they typed
 * the address, or registered before the site sent it).
 */
export function attributionSummary(a: Attribution | null | undefined): string | null {
  if (!a) return null;
  const touch = pick(a.last_touch) ?? pick(a.first_touch);
  if (!touch) return null;
  const source = touch.utm_source || (touch.gclid ? "google" : touch.fbclid ? "facebook" : referrerHost(touch.referrer));
  const medium = touch.utm_medium || (touch.gclid || touch.fbclid ? "paid" : touch.referrer ? "referral" : null);
  const head = [source, medium].filter(Boolean).join(" / ");
  return [head, touch.utm_campaign].filter(Boolean).join(" · ") || null;
}

function pick(t: AttributionTouch | undefined): AttributionTouch | null {
  if (!t) return null;
  return t.utm_source || t.utm_campaign || t.gclid || t.fbclid || t.referrer ? t : null;
}

function referrerHost(r: string | undefined): string | null {
  if (!r) return null;
  try {
    return new URL(r).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
