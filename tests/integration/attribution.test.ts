import { describe, it, expect } from "vitest";
import { attributionSummary } from "@/lib/attribution";

/** "Came from" on Registrations and Inquiries, from what the website captured. */
describe("attributionSummary", () => {
  it("says source / medium · campaign, preferring the last visit", () => {
    expect(
      attributionSummary({
        first_touch: { utm_source: "newsletter", utm_medium: "email" },
        last_touch: { utm_source: "google", utm_medium: "cpc", utm_campaign: "fall-2026" },
      })
    ).toBe("google / cpc · fall-2026");
  });

  it("falls back to the first visit, then click ids, then the referring site", () => {
    expect(attributionSummary({ first_touch: { utm_source: "flyer" }, last_touch: { landing_path: "/" } })).toBe("flyer");
    expect(attributionSummary({ last_touch: { gclid: "abc" } })).toBe("google / paid");
    expect(attributionSummary({ last_touch: { fbclid: "abc", utm_campaign: "spring" } })).toBe("facebook / paid · spring");
    expect(attributionSummary({ last_touch: { referrer: "https://www.nextdoor.com/x" } })).toBe("nextdoor.com / referral");
  });

  it("is empty when nothing useful was recorded", () => {
    expect(attributionSummary(null)).toBeNull();
    expect(attributionSummary({ ga_client_id: "1.2" })).toBeNull();
    expect(attributionSummary({ last_touch: { referrer: "not a url" } })).toBeNull();
  });
});
