import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { admin, anonPublic, seedProgram, truncateAll } from "../helpers/db";
import { sendBulkMessages } from "@/lib/actions/messages";
import { recordSmsChoice } from "@/lib/actions/consents";
import { classifySmsReply } from "@/lib/sms-keywords";
import { sendEmail } from "@/lib/email";
import { marketingFooter, sendMarketingEmail, unsubscribeHeaders } from "@/lib/marketing-email";
import { GET as unsubscribePage, POST as unsubscribe } from "@/app/api/unsubscribe/route";

/**
 * Texts go only to parents who haven't said no (STOP, or not ticking "texts"
 * on the website); promotions only to those who said yes to promotional texts
 * (sms_promotional, contract v1.3 — see promotional-texts.test.ts). Marketing email
 * needs an opt-in, an unsubscribe that works in one click, the suppression
 * list, and a postal address. Receipts and reminders are unaffected.
 */

afterEach(async () => {
  vi.useRealTimers();
  await truncateAll();
  await admin.from("config").update({ value: "" }).eq("key", "business_mailing_address");
});

let n = 0;
const phone = () => `+1817555${String(++n).padStart(4, "0")}`;

async function parent(extra: Record<string, unknown> = {}) {
  const { data } = await admin
    .from("parents")
    .insert({ first_name: "Pat", last_name: `Doe${++n}`, phone: phone(), email: `pat${n}@example.com`, ...extra })
    .select("*")
    .single();
  return data!;
}

async function queue(p: { phone: string }, purpose = "operational") {
  const { data } = await admin
    .from("message_queue")
    .insert({ recipient_phone: p.phone, recipient_name: "Pat", message: "Hi", status: "pending", purpose })
    .select("status, error")
    .single();
  return data!;
}

describe("texts respect what the parent said", () => {
  it("a family with no answer on file gets program texts but not promotions", async () => {
    const p = await parent();
    expect((await queue(p)).status).toBe("pending");
    const promo = await queue(p, "promotional");
    expect(promo.status).toBe("skipped");
    expect(promo.error).toMatch(/hasn't agreed to promotional texts/);
  });

  it("a parent who agreed gets promotions; after STOP they get nothing, and what was waiting is cleared", async () => {
    const p = await parent({ sms_consent_at: new Date().toISOString(), sms_promotional_consent_at: new Date().toISOString() });
    expect((await queue(p, "promotional")).status).toBe("pending");
    const waiting = await queue(p);
    expect(waiting.status).toBe("pending");

    await recordSmsChoice(p.id, false);
    const { data: left } = await admin.from("message_queue").select("status").eq("parent_id", p.id);
    expect(left!.every((m) => m.status === "skipped")).toBe(true);
    const after = await queue(p);
    expect(after.status).toBe("skipped");
    expect(after.error).toMatch(/STOP/);
  });

  it("a parent who didn't tick texts when registering on the website isn't texted at all — even before placement", async () => {
    const { programId } = await seedProgram();
    const p = phone();
    await anonPublic.rpc("submit_registration_v2", {
      p_offering_id: programId,
      p_parent: { first_name: "No", last_name: "Texts", phone: p },
      p_children: [{ first_name: "Kid", last_name: "Texts" }],
      p_consents: { terms: true, sms: false },
      p_attribution: null,
      p_idempotency_key: null,
    });
    expect((await queue({ phone: p })).status).toBe("skipped");
  });

  it("a contact-form texts opt-in counts; leaving it unticked means no texts to that number", async () => {
    const yes = phone();
    const no = phone();
    // v1.3: the contact form's one box covers both, so it sends both.
    for (const [p, sms] of [[yes, true], [no, false]] as const) {
      await anonPublic.rpc("submit_inquiry", { p_kind: "general", p_contact: { phone: p }, p_details: { consents: { sms, sms_promotional: sms } }, p_attribution: null });
    }
    expect((await queue({ phone: yes }, "promotional")).status).toBe("pending");
    expect((await queue({ phone: no })).status).toBe("skipped");
  });

  it("Compose reports how many it held back", async () => {
    // A Tuesday afternoon in Dallas: inside Texas quiet hours.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T15:00:00-05:00"));
    const ok = await parent({ sms_consent_at: new Date().toISOString(), sms_promotional_consent_at: new Date().toISOString() });
    const none = await parent();
    const result = await sendBulkMessages(
      [ok, none].map((p) => ({ phone: p.phone, name: "Pat" })),
      "New fall program!",
      undefined,
      "promotional"
    );
    expect(result).toEqual({ count: 2, skipped: 1 });
  });

  it("reads STOP and HELP replies the way the FCC lists them", () => {
    for (const s of ["STOP", "stop.", " Unsubscribe ", "opt out", "Cancel", "QUIT", "end", "revoke", "STOP ALL"]) {
      expect(classifySmsReply(s), s).toBe("opt_out");
    }
    expect(classifySmsReply("help")).toBe("help");
    expect(classifySmsReply("START")).toBe("opt_in");
    expect(classifySmsReply("stop by at 5?")).toBeNull();
  });
});

function fakeSender() {
  const sent: any[] = [];
  return {
    sent,
    sender: { emails: { async send(payload: any) { sent.push(payload); return { data: { id: "em_1" }, error: null }; } } } as any,
  };
}

const newsletter = (parentId: string) => ({ parentId, campaign: "fall-2026", subject: "Fall news", text: "Hello", html: "<p>Hello</p>" });

describe("marketing email", () => {
  it("needs an opt-in and a postal address, then carries the unsubscribe headers and footer", async () => {
    await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
    const { sender, sent } = fakeSender();
    const noOptIn = await parent();
    expect(await sendMarketingEmail(admin, newsletter(noOptIn.id), sender)).toBe("no_consent");

    const p = await parent({ marketing_email_consent_at: new Date().toISOString() });
    expect(await sendMarketingEmail(admin, newsletter(p.id), sender)).toBe("no_mailing_address");

    await admin.from("config").update({ value: "PO Box 123, Frisco, TX 75034" }).eq("key", "business_mailing_address");
    expect(await sendMarketingEmail(admin, newsletter(p.id), sender)).toBe("sent");
    expect(sent[0].headers["List-Unsubscribe"]).toContain(`/api/unsubscribe?t=${p.unsubscribe_token}`);
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0].text).toContain("PO Box 123");
    expect(sent[0].html).toContain("Unsubscribe");
  });

  it("one click unsubscribes; a link scanner's GET doesn't; receipts still go", async () => {
    await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
    await admin.from("config").update({ value: "PO Box 1" }).eq("key", "business_mailing_address");
    const p = await parent({ marketing_email_consent_at: new Date().toISOString() });
    const url = `http://localhost/api/unsubscribe?t=${p.unsubscribe_token}`;

    await unsubscribePage(new NextRequest(url));
    let { data: row } = await admin.from("parents").select("marketing_email_opt_out_at").eq("id", p.id).single();
    expect(row!.marketing_email_opt_out_at).toBeNull();

    const res = await unsubscribe(new NextRequest(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(res.status).toBe(200);
    ({ data: row } = await admin.from("parents").select("marketing_email_opt_out_at").eq("id", p.id).single());
    expect(row!.marketing_email_opt_out_at).toBeTruthy();

    const { sender, sent } = fakeSender();
    expect(await sendMarketingEmail(admin, newsletter(p.id), sender)).toBe("no_consent");
    // On the suppression list for marketing only: a receipt still goes.
    expect(
      await sendEmail(admin, { kind: "receipt", dedupeKey: `r:${p.id}`, parentId: p.id, to: p.email, subject: "Receipt", text: "t", html: "h" }, sender)
    ).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("a hard bounce on the suppression list stops everything", async () => {
    await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
    const p = await parent();
    await admin.from("email_suppressions").insert({ email: p.email, scope: "all", reason: "bounced" });
    const { sender } = fakeSender();
    expect(
      await sendEmail(admin, { kind: "receipt", dedupeKey: `r2:${p.id}`, parentId: p.id, to: p.email, subject: "R", text: "t", html: "h" }, sender)
    ).toBe("suppressed");
  });

  it("builds the RFC 8058 headers and footer", () => {
    expect(unsubscribeHeaders("https://x/u", "boss@example.com")).toEqual({
      "List-Unsubscribe": "<https://x/u>, <mailto:boss@example.com?subject=unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(marketingFooter({ brand: "RS", address: "PO Box 9", url: "https://x/u" }).text).toContain("Unsubscribe: https://x/u");
  });
});
