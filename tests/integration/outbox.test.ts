import { describe, it, expect, afterEach } from "vitest";
import { admin, truncateAll } from "../helpers/db";
import { smsLink, whatsappLink } from "@/lib/outbox";
import { markOutboxMessage, skipAllPending } from "@/lib/actions/outbox";

/**
 * The outbox hands each message to WhatsApp or Messages on the owner's phone.
 * What can go wrong is the link: a number in the wrong shape opens a chat with
 * nobody, and text that isn't encoded arrives cut off at the first "&".
 */

afterEach(truncateAll);

describe("the links", () => {
  it("opens WhatsApp to the parent, whatever format the number was saved in", () => {
    for (const phone of ["(915) 500-2487", "+1 915 500 2487", "9155002487"]) {
      expect(whatsappLink(phone, "Hi")).toBe("https://wa.me/19155002487?text=Hi");
    }
  });

  it("carries the whole message, including characters that would end a URL", () => {
    const text = "Hi Raquel! $100 for Mia & Leo — pay here: https://app.risingstars.training/pay/abc?x=1\n\nThanks";
    const link = whatsappLink("9155002487", text)!;
    expect(decodeURIComponent(new URL(link).searchParams.get("text")!)).toBe(text);
  });

  it("opens Messages in a form both iPhone and Android read", () => {
    expect(smsLink("915-500-2487", "Hi there")).toBe("sms:+19155002487?&body=Hi%20there");
  });

  it("offers nothing for a number too short to dial", () => {
    expect(whatsappLink("500-2487", "Hi")).toBeNull();
    expect(smsLink("", "Hi")).toBeNull();
  });
});

describe("marking messages", () => {
  it("refuses anyone who isn't signed in", async () => {
    const { data } = await admin
      .from("message_queue")
      .insert({ recipient_phone: "+19155002487", message: "Hi", status: "pending" })
      .select("id")
      .single();

    expect(await markOutboxMessage(data!.id, "whatsapp")).toHaveProperty("error", expect.stringMatching(/sign in/i));
    expect(await skipAllPending()).toHaveProperty("error", expect.stringMatching(/sign in/i));
    const { data: after } = await admin.from("message_queue").select("status").eq("id", data!.id).single();
    expect(after!.status).toBe("pending");
  });
});
