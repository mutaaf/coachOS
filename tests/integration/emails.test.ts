import { describe, it, expect, afterEach, beforeEach, afterAll } from "vitest";
import type Stripe from "stripe";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { sendEmail } from "@/lib/email";
import { settleAutopay, failAutopay } from "@/lib/autopay";
import { ingestZelleEmail } from "@/lib/zelle";
import { generateMonthlyInvoices, recordPayment } from "@/lib/actions/payments";
import { GET as cron } from "@/app/api/cron/daily-reminders/route";
import { businessMonth, businessDaysAgo } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Email that sends itself. What must hold: one email per event however many
 * times the event is reported, nothing for families without an address, and
 * nothing that can turn a payment that went through into an error.
 *
 * These run without a Resend key, as CI does, so emails are recorded as
 * "skipped" with their full content — which is what is checked. The sending
 * path itself is tested with a fake sender.
 */

const db = admin as unknown as OpsClient;
const CONFIG = ["emails_enabled", "email_reply_to", "auto_generate_invoices", "practice_reminders_enabled"];
let saved: { key: string; value: string }[] = [];

beforeEach(async () => {
  const { data } = await admin.from("config").select("key, value").in("key", CONFIG);
  saved = data || [];
  await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
});
afterEach(async () => {
  for (const r of saved) await admin.from("config").update({ value: r.value }).eq("key", r.key);
  await truncateAll();
});
afterAll(truncateAll);

function fakeSender(fail = false) {
  const sent: { payload: any; options: any }[] = [];
  return {
    sent,
    sender: {
      emails: {
        async send(payload: any, options: any) {
          sent.push({ payload, options });
          return fail
            ? { data: null, error: { message: "Domain not verified", name: "validation_error" } }
            : { data: { id: `em_${sent.length}` }, error: null };
        },
      },
    } as any,
  };
}

const email = (over: Partial<Parameters<typeof sendEmail>[1]> = {}) => ({
  kind: "receipt" as const,
  dedupeKey: "receipt:test",
  parentId: null,
  to: "raquel@example.com",
  subject: "Receipt",
  text: "Thanks",
  html: "<p>Thanks</p>",
  ...over,
});

async function emails() {
  const { data } = await admin.from("emails").select("kind, to_address, subject, body_text, status, error, dedupe_key");
  return data!;
}

/** A parent with an email, children on a $100 program, and this month's invoices. */
async function family(children = ["Mia"], withEmail = true) {
  const { programId } = await seedProgram({ monthlyFee: 100 });
  const { data: parent } = await admin
    .from("parents")
    .insert({
      first_name: "Raquel",
      last_name: "Garcia",
      phone: "+19155002487",
      email: withEmail ? "raquel@example.com" : null,
      autopay_label: "Visa ••••4242",
    })
    .select("id")
    .single();
  for (const c of children) {
    const { data: s } = await admin.from("students").insert({ first_name: c, last_name: "Garcia" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: parent!.id });
    await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  }
  await generateMonthlyInvoices(businessMonth());
  const { data: invoices } = await admin.from("invoices").select("id").eq("parent_id", parent!.id).order("created_at");
  return { parentId: parent!.id as string, invoiceIds: invoices!.map((i) => i.id as string) };
}

describe("sending", () => {
  it("sends through Resend, from the configured sender, with replies to her inbox", async () => {
    await admin.from("config").update({ value: "anum@example.com" }).eq("key", "email_reply_to");
    const { sender, sent } = fakeSender();

    expect(await sendEmail(db, email(), sender)).toBe("sent");

    expect(sent[0].payload).toMatchObject({
      from: "Rising Stars <payments@risingstars.training>",
      to: "raquel@example.com",
      replyTo: "anum@example.com",
    });
    // The event is also Resend's idempotency key: a lost reply can't become a second email.
    expect(sent[0].options).toEqual({ idempotencyKey: "receipt:test" });
    expect((await emails())[0].status).toBe("sent");
  });

  it("sends one email per event, however many times it is reported", async () => {
    const { sender, sent } = fakeSender();
    await sendEmail(db, email(), sender);
    expect(await sendEmail(db, email(), sender)).toBe("duplicate");
    expect(sent).toHaveLength(1);
  });

  it("records a failure instead of throwing", async () => {
    expect(await sendEmail(db, email(), fakeSender(true).sender)).toBe("failed");
    expect((await emails())[0]).toMatchObject({ status: "failed", error: "Domain not verified" });
  });

  it("does nothing for a family with no email, or when email is switched off", async () => {
    const { sender, sent } = fakeSender();
    expect(await sendEmail(db, email({ to: null }), sender)).toBe("no_address");
    expect(await sendEmail(db, email({ to: "not-an-email" }), sender)).toBe("no_address");
    await admin.from("config").update({ value: "false" }).eq("key", "emails_enabled");
    expect(await sendEmail(db, email({ dedupeKey: "x" }), sender)).toBe("disabled");
    expect(sent).toHaveLength(0);
  });
});

describe("receipts", () => {
  it("one receipt for an autopay charge that covered two children, even when Stripe reports it twice", async () => {
    const f = await family(["Ada", "Obi"]);
    const pi = {
      id: "pi_1",
      status: "succeeded",
      amount: 20_600,
      amount_received: 20_600,
      metadata: {
        source: "autopay",
        parent_id: f.parentId,
        invoice_ids: f.invoiceIds.join(","),
        balances: "10000,10000",
        fees: "300,300",
      },
    } as unknown as Stripe.PaymentIntent;

    await settleAutopay(db, pi);
    await settleAutopay(db, pi);

    const sent = await emails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "receipt", to_address: "raquel@example.com", status: "skipped" });
    expect(sent[0].subject).toContain("$206.00");
    expect(sent[0].body_text).toContain("Ada");
    expect(sent[0].body_text).toContain("Obi");
    expect(sent[0].body_text).toContain("Card processing fee: $6.00");
    expect(sent[0].body_text).toContain("Paid by Visa ••••4242");
  });

  it("a receipt when a Zelle payment is matched from the bank's email", async () => {
    await family(["Mia"]);

    await ingestZelleEmail(db, { messageId: "z1", subject: "Raquel Garcia sent you $100.00", text: "" });

    const [sent] = await emails();
    expect(sent.subject).toContain("$100.00");
    expect(sent.body_text).toContain("Paid by Zelle");
  });

  it("a receipt when she records a payment by hand", async () => {
    const f = await family(["Mia"]);
    const fd = new FormData();
    fd.set("invoice_id", f.invoiceIds[0]);
    fd.set("amount", "100");
    fd.set("method", "cash");

    await recordPayment(fd);

    const [sent] = await emails();
    expect(sent.body_text).toContain("Paid by cash");
  });

  it("nothing for a family without an email", async () => {
    await family(["Mia"], false);
    await ingestZelleEmail(db, { messageId: "z2", subject: "Raquel Garcia sent you $100.00", text: "" });
    expect(await emails()).toHaveLength(0);
  });
});

describe("notices", () => {
  it("one failed-payment email for the family, not one per child", async () => {
    const f = await family(["Ada", "Obi"]);
    await admin.from("invoices").update({ status: "processing", autopay_status: "processing" }).in("id", f.invoiceIds);
    const fail = { invoiceIds: f.invoiceIds, paymentIntentId: "pi_x", reason: "Your card was declined.", parentId: f.parentId };

    await failAutopay(db, fail);
    await failAutopay(db, fail);

    const sent = await emails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "payment_failed" });
    expect(sent[0].body_text).toContain("$200.00 for Ada and Obi");
  });

  it("an overdue family is reminded once — by WhatsApp and email together — not every day", async () => {
    await admin.from("config").update({ value: "false" }).eq("key", "auto_generate_invoices");
    await admin.from("config").update({ value: "false" }).eq("key", "practice_reminders_enabled");
    const f = await family(["Ada", "Obi"]);
    await admin.from("invoices").update({ due_date: businessDaysAgo(10), status: "overdue" }).in("id", f.invoiceIds);
    process.env.CRON_SECRET = "test-cron";
    const run = () =>
      cron(new Request("http://localhost/api/cron", { headers: { authorization: "Bearer test-cron" } }) as any);

    await run();
    await run();

    const { data: queued } = await admin.from("message_queue").select("message");
    expect(queued).toHaveLength(1);
    expect(queued![0].message).toContain("Ada and Obi");
    expect(queued![0].message).toContain("$200.00");
    const sent = await emails();
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("reminder");
  });
});
