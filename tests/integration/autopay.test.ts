import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type Stripe from "stripe";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { turnOffAutopay } from "@/lib/actions/pay-page";
import { getOverdueInvoices } from "@/lib/queries/payments";
import {
  cardFeeCents,
  chargeDueAutopay,
  failAutopay,
  saveSetupIntent,
  settleAutopay,
} from "@/lib/autopay";
import { businessMonth } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Autopay charges real cards and bank accounts, so the cases here are mostly
 * about never charging twice, never charging the wrong family, and never
 * chasing a family whose money is already on its way.
 *
 * Stripe itself is replaced by a fake that records what it was asked to do;
 * these tests are about what this app asks for, and what it does with the
 * answer.
 */

const db = admin as unknown as OpsClient;

afterEach(truncateAll);

type Behaviour = "succeeded" | "processing" | "requires_action" | { decline: string };

function fakeStripe(behaviour: Behaviour = "succeeded") {
  const created: { params: any; idempotencyKey?: string }[] = [];
  const seenKeys = new Map<string, any>();
  const voided: string[] = [];
  const cancelled: string[] = [];
  let n = 0;

  const stripe = {
    paymentIntents: {
      async create(params: any, opts?: { idempotencyKey?: string }) {
        // Stripe returns the original result for a repeated idempotency key.
        if (opts?.idempotencyKey && seenKeys.has(opts.idempotencyKey)) {
          return seenKeys.get(opts.idempotencyKey);
        }
        await new Promise((r) => setTimeout(r, 5));
        created.push({ params, idempotencyKey: opts?.idempotencyKey });
        const id = `pi_test_${++n}`;
        if (typeof behaviour === "object") {
          const err: any = new Error(behaviour.decline);
          err.raw = { payment_intent: { id } };
          throw err;
        }
        const pi = {
          id,
          status: behaviour,
          amount: params.amount,
          amount_received: behaviour === "succeeded" ? params.amount : 0,
          metadata: params.metadata,
        };
        if (opts?.idempotencyKey) seenKeys.set(opts.idempotencyKey, pi);
        return pi;
      },
      async cancel(id: string) {
        cancelled.push(id);
      },
    },
    invoices: {
      async voidInvoice(id: string) {
        voided.push(id);
      },
    },
  };

  return { stripe: stripe as unknown as Stripe, created, voided, cancelled };
}

/** A family on a $100/month program, with this month's invoice. */
async function family(opts: {
  autopay?: "card" | "us_bank_account" | null;
  parents?: number;
  autopayParentIndex?: number;
} = {}) {
  const { autopay = "card", parents = 1, autopayParentIndex = 0 } = opts;
  const { programId } = await seedProgram({ monthlyFee: 100 });

  const { data: student } = await admin
    .from("students")
    .insert({ first_name: "Mia", last_name: "Garcia" })
    .select("id")
    .single();

  const parentRows = [];
  for (let i = 0; i < parents; i++) {
    const onAutopay = autopay && i === autopayParentIndex;
    const { data: p } = await admin
      .from("parents")
      .insert({
        first_name: `Parent${i}`,
        last_name: "Garcia",
        phone: `+1214555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
        stripe_customer_id: onAutopay ? `cus_${i}` : null,
        ...(onAutopay
          ? {
              autopay_status: "active",
              autopay_method: autopay,
              autopay_payment_method_id: `pm_${i}`,
              autopay_label: "Visa ••••4242",
              autopay_enabled_at: new Date(Date.now() - 86_400_000).toISOString(),
            }
          : {}),
      })
      .select("id, pay_token")
      .single();
    parentRows.push(p!);
    await admin.from("student_parents").insert({ student_id: student!.id, parent_id: p!.id });
  }

  await admin.from("enrollments").insert({ student_id: student!.id, program_id: programId, status: "active" });
  const month = businessMonth();
  await generateMonthlyInvoices(month);

  const { data: inv } = await admin
    .from("invoices")
    .select("id")
    .eq("student_id", student!.id)
    .single();

  return {
    invoiceId: inv!.id as string,
    parents: parentRows as { id: string; pay_token: string }[],
    dueDate: `${month}-01`,
  };
}

async function invoice(id: string) {
  const { data } = await admin
    .from("invoices")
    .select("status, autopay_status, autopay_error, payments(amount, fee, method, external_id)")
    .eq("id", id)
    .single();
  return data!;
}

beforeEach(async () => {
  await admin.from("config").update({ value: "3" }).eq("key", "card_fee_percent");
});

describe("the card fee", () => {
  it("is a percentage of the balance, rounded to the cent", () => {
    expect(cardFeeCents(10_000, 3)).toBe(300);
    expect(cardFeeCents(12_345, 2.9)).toBe(358);
  });

  it("is nothing when it is set to nothing", () => {
    expect(cardFeeCents(10_000, 0)).toBe(0);
  });
});

describe("charging a card", () => {
  it("charges the balance plus the stated fee, and books the invoice as paid", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("succeeded");

    const result = await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(result.paid).toBe(1);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].params).toMatchObject({
      amount: 10_300,
      payment_method: "pm_0",
      customer: "cus_0",
      off_session: true,
    });

    const inv = await invoice(f.invoiceId);
    expect(inv.status).toBe("paid");
    // The invoice balances to exactly what was owed; the fee is kept beside it.
    expect(inv.payments).toEqual([
      expect.objectContaining({ amount: 100, fee: 3, method: "stripe" }),
    ]);
  });

  it("does not charge again on the next day's run", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("succeeded");

    await chargeDueAutopay(db, fake.stripe, f.dueDate);
    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(1);
  });

  it("charges once when two runs overlap", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("succeeded");

    await Promise.all([
      chargeDueAutopay(db, fake.stripe, f.dueDate),
      chargeDueAutopay(db, fake.stripe, f.dueDate),
    ]);

    expect(fake.created).toHaveLength(1);
    expect((await invoice(f.invoiceId)).payments).toHaveLength(1);
  });

  it("waits until the due date", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("succeeded");
    const dayBefore = new Date(`${f.dueDate}T12:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    await chargeDueAutopay(db, fake.stripe, dayBefore.toISOString().slice(0, 10));

    expect(fake.created).toHaveLength(0);
  });

  it("charges only what is left after a partial payment", async () => {
    const f = await family({ autopay: "us_bank_account" });
    await admin.from("payments").insert({ invoice_id: f.invoiceId, amount: 40, method: "zelle" });
    const fake = fakeStripe("processing");

    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    // Bank accounts never carry the card fee.
    expect(fake.created[0].params.amount).toBe(6_000);
  });

  it("charges the parent who set up autopay, when the invoice is billed to the other one", async () => {
    // Invoices go to one parent per child; either may be the one paying.
    const f = await family({ autopay: "card", parents: 2, autopayParentIndex: 1 });
    const fake = fakeStripe("succeeded");

    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].params.payment_method).toBe("pm_1");
  });

  it("leaves families who aren't on autopay alone", async () => {
    const f = await family({ autopay: null });
    const fake = fakeStripe("succeeded");

    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(0);
  });

  it("stops charging the moment a parent turns it off", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("succeeded");

    expect(await turnOffAutopay(f.parents[0].pay_token)).toMatchObject({ success: true });
    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(0);
  });

  it("voids a hosted Stripe invoice for the same month, so it can't be paid twice", async () => {
    const f = await family({ autopay: "card" });
    await admin
      .from("invoices")
      .update({ stripe_invoice_id: "in_hosted", stripe_hosted_invoice_url: "https://pay.example/x" })
      .eq("id", f.invoiceId);
    const fake = fakeStripe("succeeded");

    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.voided).toEqual(["in_hosted"]);
  });
});

describe("a bank debit, which takes days to settle", () => {
  it("is not chased as overdue while it is on its way", async () => {
    const f = await family({ autopay: "us_bank_account" });
    // Due in the past, so the overdue sweep would otherwise catch it.
    await admin.from("invoices").update({ due_date: "2026-01-01" }).eq("id", f.invoiceId);
    const fake = fakeStripe("processing");

    const result = await chargeDueAutopay(db, fake.stripe, "2026-01-01");
    expect(result.processing).toBe(1);

    const overdue = await getOverdueInvoices();
    expect(overdue.map((i: any) => i.id)).not.toContain(f.invoiceId);
    expect((await invoice(f.invoiceId)).status).toBe("processing");
  });

  it("is booked as paid once the webhook says it settled, and only once", async () => {
    const f = await family({ autopay: "us_bank_account" });
    const fake = fakeStripe("processing");
    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    const settled = {
      id: "pi_test_1",
      status: "succeeded",
      amount: 10_000,
      amount_received: 10_000,
      metadata: fake.created[0].params.metadata,
    } as unknown as Stripe.PaymentIntent;

    // Stripe redelivers webhooks.
    await settleAutopay(db, settled);
    await settleAutopay(db, settled);

    const inv = await invoice(f.invoiceId);
    expect(inv.status).toBe("paid");
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ amount: 100, fee: 0, external_id: "pi_test_1" });
  });
});

describe("a charge that fails", () => {
  it("puts the invoice back to owed and tells the parent once, with their link", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe({ decline: "Your card was declined." });

    const result = await chargeDueAutopay(db, fake.stripe, f.dueDate);
    expect(result.failed).toBe(1);

    const inv = await invoice(f.invoiceId);
    expect(["pending", "overdue"]).toContain(inv.status);
    expect(inv.autopay_status).toBe("failed");

    // Stripe also reports the failure by webhook; that must not message again.
    await failAutopay(db, {
      invoiceId: f.invoiceId,
      paymentIntentId: "pi_test_1",
      reason: "Your card was declined.",
      parentId: f.parents[0].id,
    });

    const { data: messages } = await admin.from("message_queue").select("message");
    expect(messages).toHaveLength(1);
    expect(messages![0].message).toContain("your card was declined");
    expect(messages![0].message).toContain(`/pay/${f.parents[0].pay_token}`);
  });

  it("is not retried on the same card every day", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe({ decline: "Your card was declined." });

    await chargeDueAutopay(db, fake.stripe, f.dueDate);
    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(1);
  });

  it("is retried once the parent saves a new payment method", async () => {
    const f = await family({ autopay: "card" });
    await chargeDueAutopay(db, fakeStripe({ decline: "Your card was declined." }).stripe, f.dueDate);

    await admin
      .from("parents")
      .update({ autopay_payment_method_id: "pm_new", autopay_enabled_at: new Date(Date.now() + 1000).toISOString() })
      .eq("id", f.parents[0].id);
    const fake = fakeStripe("succeeded");
    await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].params.payment_method).toBe("pm_new");
    expect((await invoice(f.invoiceId)).status).toBe("paid");
  });

  it("cancels a card charge that wants confirmation nobody is there to give", async () => {
    const f = await family({ autopay: "card" });
    const fake = fakeStripe("requires_action");

    const result = await chargeDueAutopay(db, fake.stripe, f.dueDate);

    expect(result.failed).toBe(1);
    expect(fake.cancelled).toEqual(["pi_test_1"]);
    expect((await invoice(f.invoiceId)).autopay_status).toBe("failed");
  });
});

describe("saving what the parent set up in Stripe", () => {
  async function bareParent() {
    const { data } = await admin
      .from("parents")
      .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145550199" })
      .select("id")
      .single();
    return data!.id as string;
  }

  async function parent(id: string) {
    const { data } = await admin
      .from("parents")
      .select("autopay_status, autopay_method, autopay_label, autopay_payment_method_id, autopay_verify_url")
      .eq("id", id)
      .single();
    return data!;
  }

  const card = { id: "pm_card", type: "card", card: { brand: "visa", last4: "4242" } };
  const bank = {
    id: "pm_bank",
    type: "us_bank_account",
    us_bank_account: { bank_name: "Chase", last4: "6789" },
  };

  it("turns autopay on for a card", async () => {
    const id = await bareParent();

    await saveSetupIntent(db, {
      status: "succeeded",
      metadata: { parent_id: id },
      payment_method: card,
    } as unknown as Stripe.SetupIntent);

    expect(await parent(id)).toMatchObject({
      autopay_status: "active",
      autopay_method: "card",
      autopay_label: "Visa ••••4242",
      autopay_payment_method_id: "pm_card",
    });
  });

  it("holds a bank account that needs micro-deposits until it is verified", async () => {
    const id = await bareParent();
    const pending = {
      status: "requires_action",
      next_action: {
        type: "verify_with_microdeposits",
        verify_with_microdeposits: { hosted_verification_url: "https://verify.example/x" },
      },
      metadata: { parent_id: id },
      payment_method: bank,
    } as unknown as Stripe.SetupIntent;

    await saveSetupIntent(db, pending);
    expect(await parent(id)).toMatchObject({
      autopay_status: "pending",
      autopay_label: "Chase ••••6789",
      autopay_verify_url: "https://verify.example/x",
    });

    await saveSetupIntent(db, { ...pending, status: "succeeded", next_action: null } as any);
    expect(await parent(id)).toMatchObject({ autopay_status: "active", autopay_verify_url: null });
  });
});
