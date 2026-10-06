import { describe, it, expect, afterEach, vi } from "vitest";
import { admin, truncateAll } from "../helpers/db";
import { nextPromotionalWindow, promotionalTextAllowed, quietHoursMessage } from "@/lib/quiet-hours";
import { sendBulkMessages } from "@/lib/actions/messages";
import { markOutboxMessage } from "@/lib/actions/outbox";

/**
 * Texas quiet hours for promotional texts (Tex. Bus. & Com. Code §301.051):
 * Mon–Sat 9 a.m.–9 p.m., Sun noon–9 p.m., on Dallas's clock — through both
 * daylight-saving changes. Practice and payment texts are not affected.
 */

afterEach(async () => {
  vi.useRealTimers();
  await truncateAll();
});

// [instant, allowed, what it is]
const CASES: [string, boolean, string][] = [
  // A Monday in October (CDT, UTC-5).
  ["2026-10-05T13:59:59Z", false, "Mon 8:59:59 a.m."],
  ["2026-10-05T14:00:00Z", true, "Mon 9:00 a.m."],
  ["2026-10-06T02:00:00Z", true, "Mon 9:00:00 p.m. exactly"],
  ["2026-10-06T02:00:01Z", false, "Mon 9:00:01 p.m."],
  ["2026-10-10T13:59:00Z", false, "Sat 8:59 a.m."],
  ["2026-10-10T14:00:00Z", true, "Sat 9:00 a.m."],
  // Sunday: noon, not 9.
  ["2026-10-04T14:00:00Z", false, "Sun 9:00 a.m."],
  ["2026-10-04T16:59:59Z", false, "Sun 11:59:59 a.m."],
  ["2026-10-04T17:00:00Z", true, "Sun noon"],
  ["2026-10-05T02:00:00Z", true, "Sun 9:00 p.m."],
  ["2026-10-05T02:01:00Z", false, "Sun 9:01 p.m."],
  // DST begins Sun 8 Mar 2026: noon is 17:00Z (CDT). Read as CST it would be 11 a.m.
  ["2026-03-08T16:59:59Z", false, "Sun 8 Mar 11:59:59 a.m. CDT"],
  ["2026-03-08T17:00:00Z", true, "Sun 8 Mar noon CDT"],
  // The Friday before, still CST (UTC-6): 9 p.m. is 03:00Z Saturday.
  ["2026-03-07T03:00:00Z", true, "Fri 6 Mar 9:00 p.m. CST"],
  ["2026-03-07T03:00:01Z", false, "Fri 6 Mar 9:00:01 p.m. CST"],
  // DST ends Sun 1 Nov 2026: noon is 18:00Z (CST). Read as CDT 17:59Z would be 12:59.
  ["2026-11-01T17:59:59Z", false, "Sun 1 Nov 11:59:59 a.m. CST"],
  ["2026-11-01T18:00:00Z", true, "Sun 1 Nov noon CST"],
  ["2026-11-02T14:59:00Z", false, "Mon 2 Nov 8:59 a.m. CST"],
  ["2026-11-02T15:00:00Z", true, "Mon 2 Nov 9:00 a.m. CST"],
  // The repeated 1 a.m. hour on 1 Nov is quiet either way.
  ["2026-11-01T06:30:00Z", false, "Sun 1 Nov 1:30 a.m. CDT"],
  ["2026-11-01T07:30:00Z", false, "Sun 1 Nov 1:30 a.m. CST"],
];

describe("the rule", () => {
  it.each(CASES)("%s is %s (%s)", (iso, allowed) => {
    expect(promotionalTextAllowed(new Date(iso))).toBe(allowed);
  });

  it("the database agrees at every boundary", async () => {
    for (const [iso, allowed, what] of CASES) {
      const { data, error } = await admin.rpc("promotional_text_allowed", { p_at: iso });
      expect(error).toBeNull();
      expect(data, what).toBe(allowed);
    }
  });

  it("says when promotions can go again", () => {
    expect(nextPromotionalWindow(new Date("2026-10-05T12:00:00Z"))).toBe("9 a.m. today"); // Mon 7 a.m.
    expect(nextPromotionalWindow(new Date("2026-10-04T15:00:00Z"))).toBe("noon today"); // Sun 10 a.m.
    expect(nextPromotionalWindow(new Date("2026-10-11T03:30:00Z"))).toBe("noon tomorrow (Sunday)"); // Sat 10:30 p.m.
    expect(nextPromotionalWindow(new Date("2026-10-05T03:30:00Z"))).toBe("9 a.m. tomorrow (Monday)"); // Sun 10:30 p.m.
    expect(quietHoursMessage(new Date("2026-10-05T15:00:00Z"))).toBeNull();
    expect(quietHoursMessage(new Date("2026-10-05T03:30:00Z"))).toMatch(/Texas law.*Sunday noon–9 p\.m\./);
  });
});

let n = 0;
const phone = () => `+1469555${String(++n).padStart(4, "0")}`;

async function consentedParent() {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("parents")
    .insert({ first_name: "Quiet", last_name: `Hours${++n}`, phone: phone(), sms_consent_at: now, sms_promotional_consent_at: now })
    .select("*")
    .single();
  return data!;
}

describe("Compose and the Outbox keep quiet hours for promotions only", () => {
  it("refuses to queue a promotion at 10 p.m.; a practice message still goes", async () => {
    const p = await consentedParent();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z")); // Tue 10 p.m. in Dallas
    const promo = await sendBulkMessages([{ phone: p.phone, name: "Quiet" }], "Fall camp sale!", undefined, "promotional");
    expect(promo).toEqual({ error: expect.stringMatching(/Texas law doesn't allow promotional texts right now/) });
    const { count } = await admin.from("message_queue").select("id", { count: "exact", head: true });
    expect(count).toBe(0);

    const op = await sendBulkMessages([{ phone: p.phone, name: "Quiet" }], "Practice moved to the gym", undefined, "operational");
    expect(op).toEqual({ count: 1, skipped: 0 });
  });

  it("won't mark a waiting promotion sent during quiet hours; operational messages are unaffected", async () => {
    const p = await consentedParent();
    const rows = await admin
      .from("message_queue")
      .insert([
        { recipient_phone: p.phone, recipient_name: "Quiet", message: "Offer", status: "pending", purpose: "promotional" },
        { recipient_phone: p.phone, recipient_name: "Quiet", message: "Practice", status: "pending", purpose: "operational" },
      ])
      .select("id, purpose, status");
    const promo = rows.data!.find((r) => r.purpose === "promotional")!;
    const op = rows.data!.find((r) => r.purpose === "operational")!;
    expect(promo.status).toBe("pending");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T15:00:00Z")); // Sun 10 a.m.
    expect(await markOutboxMessage(promo.id, "whatsapp")).toEqual({ error: expect.stringMatching(/noon today/) });
    const { data: still } = await admin.from("message_queue").select("status").eq("id", promo.id).single();
    expect(still!.status).toBe("pending");
    // Skipping it is always allowed.
    expect(await markOutboxMessage(promo.id, "skipped")).toEqual({ success: true });
    vi.useRealTimers();

    // The operational one is marked sent whatever the time (database clock).
    expect(await markOutboxMessage(op.id, "sms")).toEqual({ success: true });
  });

  it("the database refuses to mark a promotion sent outside quiet hours, by its own clock", async () => {
    const p = await consentedParent();
    const { data: row } = await admin
      .from("message_queue")
      .insert({ recipient_phone: p.phone, recipient_name: "Quiet", message: "Offer", status: "pending", purpose: "promotional" })
      .select("id")
      .single();
    const allowedNow = promotionalTextAllowed(new Date());
    const { error } = await admin.from("message_queue").update({ status: "sent", sent_via: "sms" }).eq("id", row!.id);
    if (allowedNow) expect(error).toBeNull();
    else expect(error?.message).toMatch(/Texas law doesn't allow promotional texts right now/);
  });
});
