import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { matchZelleReceipt, undoZelleMatch } from "@/lib/actions/zelle";
import { rememberZelleName } from "@/lib/actions/pay-page";
import { ingestZelleEmail, parseZelleEmail, senderKey } from "@/lib/zelle";
import { POST as inbound } from "@/app/api/inbound/zelle/route";
import { businessMonth } from "@/lib/dates";
import type { OpsClient } from "@/lib/supabase/types";

/**
 * Zelle payments recorded from the bank's emails.
 *
 * The thing being protected is the books: a payment recorded against the wrong
 * child, or recorded twice, is worse than one that waits for the owner. So most
 * of these are about what must NOT be matched automatically.
 */

const db = admin as unknown as OpsClient;

afterEach(truncateAll);

let msg = 0;
const email = (subject: string, text = "") => ({ messageId: `m-${Date.now()}-${++msg}`, subject, text });

function monthAfter(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** A parent with children on a $100/month program, and this month's invoices. */
async function family(
  parent: { first: string; last: string },
  children: string[] = ["Mia"],
  months: string[] = [businessMonth()]
) {
  const { programId } = await seedProgram({ monthlyFee: 100 });
  const { data: p } = await admin
    .from("parents")
    .insert({
      first_name: parent.first,
      last_name: parent.last,
      phone: `+1214555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    })
    .select("id, pay_token")
    .single();

  for (const child of children) {
    const { data: s } = await admin
      .from("students")
      .insert({ first_name: child, last_name: parent.last })
      .select("id")
      .single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });
    await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });
  }
  for (const month of months) await generateMonthlyInvoices(month);

  return { parentId: p!.id as string, payToken: p!.pay_token as string, programId };
}

async function invoices(parentId: string) {
  const { data } = await admin
    .from("invoices")
    .select("id, month, status, payments(amount, method, zelle_receipt_id)")
    .eq("parent_id", parentId)
    .order("month");
  return data!;
}

async function receipt(id: string) {
  const { data } = await admin.from("zelle_receipts").select("*").eq("id", id).single();
  return data!;
}


// A Chase alert forwarded from Yahoo Mail on an iPhone: the stylesheet comes
// through as text, and the table's cells as "| ... |". (Names made up.)
const YAHOO_FORWARDED_CHASE = [
  "", "", "", "Sent from Yahoo Mail for iPhone", "", "", "Begin forwarded message:", "",
  "On Friday, October 2, 2026, 9:17 AM, Chase <no.reply.alerts@chase.com> wrote:", "", " ",
  "#yiv2029607686 * {line-height:normal !important;}#yiv2029607686 strong {font-weight:bold !important;}" + " x".repeat(3000),
  "|  ", "|  ", "|  |  ", "| ", "|  |", "", " |", "| Zelle® payment |", "", "  |",
  "| LAYLA RIVERA sent you money |", "", "  |  |", "", "  |", "| Here are the details: |", "|  ",
  "| Amount | $100.00 |", "", "  |", "| Sent on | Oct 02, 2026 |", "", "  |",
  "| Transaction number | 31054552896 |", "", "  |", "| Memo | Nico Lil Dribblers |", "", "  |",
  "|  LAYLA RIVERA is registered with a Zelle® member bank that supports...",
].join("\r\n");

describe("reading bank emails", () => {
  it("reads a Chase alert forwarded from Yahoo, table and all", () => {
    expect(parseZelleEmail("Fw: You received money with Zelle®", YAHOO_FORWARDED_CHASE)).toEqual({
      kind: "incoming",
      senderName: "LAYLA RIVERA",
      amount: 100,
      memo: "Nico Lil Dribblers",
    });
  });

  it("an email it couldn't read before is read again when it comes back", async () => {
    const messageId = "yahoo-fwd-1";
    // As the old reader stored it.
    await admin.from("zelle_receipts").insert({ message_id: messageId, status: "unreadable", subject: "Fw: You received money with Zelle®" });
    const result = await ingestZelleEmail(db, { messageId, subject: "Fw: You received money with Zelle®", text: YAHOO_FORWARDED_CHASE });
    expect(result.outcome).toBe("unmatched");
    const { data } = await admin.from("zelle_receipts").select("status, sender_name, amount, memo").eq("message_id", messageId);
    expect(data).toEqual([{ status: "unmatched", sender_name: "LAYLA RIVERA", amount: 100, memo: "Nico Lil Dribblers" }]);
    // And again on the next run: still one.
    expect((await ingestZelleEmail(db, { messageId, subject: "x", text: YAHOO_FORWARDED_CHASE })).outcome).toBe("duplicate");
  });

  it("never replaces one she has already dealt with", async () => {
    await admin.from("zelle_receipts").insert({ message_id: "dealt-1", status: "ignored", subject: "s" });
    expect((await ingestZelleEmail(db, { messageId: "dealt-1", subject: "s", text: YAHOO_FORWARDED_CHASE })).outcome).toBe("duplicate");
    const { data } = await admin.from("zelle_receipts").select("status").eq("message_id", "dealt-1");
    expect(data).toEqual([{ status: "ignored" }]);
  });

  it.each([
    ["Bank of America", "Raquel Garcia sent you $100.00", "", "Raquel Garcia", 100],
    [
      "Chase",
      "You received money with Zelle®",
      "Raquel Garcia sent you money\n\nAmount: $100.00\nMemo: Mia October",
      "Raquel Garcia",
      100,
    ],
    ["Wells Fargo", "You received $1,250.00 from RAQUEL M. GARCIA", "", "RAQUEL M. GARCIA", 1250],
    ["Capital One", "You've received $100.00 via Zelle from Raquel Garcia.", "", "Raquel Garcia", 100],
    [
      "a greeting before the name",
      "Zelle payment",
      "Hi Anum, Raquel Garcia sent you $100.00. It's in your account.",
      "Raquel Garcia",
      100,
    ],
  ])("reads %s", (_bank, subject, body, name, amount) => {
    const parsed = parseZelleEmail(subject, body);
    expect(parsed).toMatchObject({ kind: "incoming", senderName: name, amount });
  });

  // Her bank's alerts go to a Yahoo inbox and are forwarded to the Gmail the
  // script reads, so every alert arrives as a forward.
  it.each([
    [
      "forwarded from Gmail",
      "Fwd: Raquel Garcia sent you $100.00",
      "---------- Forwarded message ---------\nFrom: Bank of America <alerts@bankofamerica.com>\nSubject: Raquel Garcia sent you $100.00\nTo: <anumm786@yahoo.com>\n\nRaquel Garcia sent you $100.00\nMemo: Mia Oct",
      { senderName: "Raquel Garcia", amount: 100, memo: "Mia Oct" },
    ],
    [
      "forwarded from Yahoo",
      "Fwd: You received money with Zelle®",
      "----- Forwarded Message -----\nFrom: Chase <no.reply.alerts@chase.com>\nTo: anumm786@yahoo.com\n\nStar Okafor sent you money\nAmount: $200.00",
      { senderName: "Star Okafor", amount: 200 },
    ],
    [
      "forwarded from an iPhone, quoted",
      "Fwd: You received $100.00 from YOOMI PARK",
      "Begin forwarded message:\n\n> From: Wells Fargo <alerts@notify.wellsfargo.com>\n>\n> You received $100.00 from YOOMI PARK.\n> Memo: Jin",
      { senderName: "YOOMI PARK", amount: 100, memo: "Jin" },
    ],
  ])("reads an alert %s", (_how, subject, body, expected) => {
    expect(parseZelleEmail(subject, body)).toMatchObject({ kind: "incoming", ...expected });
  });

  it("still ignores her own payments when they arrive forwarded", () => {
    expect(parseZelleEmail("Fwd: You sent $40.00 to Coach Store", "You sent $40.00 to Coach Store")).toEqual({
      kind: "outgoing",
    });
  });

  it("keeps the memo", () => {
    const parsed = parseZelleEmail("Raquel Garcia sent you $100.00", "Memo: Mia - Oct");
    expect(parsed).toMatchObject({ memo: "Mia - Oct" });
  });

  it.each([
    ["money she sent", "You sent $40.00 to Coach Store"],
    ["a request she made", "Your request for $100.00 was sent to Raquel Garcia"],
  ])("ignores %s", (_what, subject) => {
    expect(parseZelleEmail(subject, "")).toEqual({ kind: "outgoing" });
  });

  it("reads an incoming alert even when its subject mentions a request", () => {
    expect(parseZelleEmail("Payment request paid: Raquel Garcia sent you $100.00", "")).toMatchObject({
      kind: "incoming",
      senderName: "Raquel Garcia",
      amount: 100,
    });
  });

  it("says when it can't read one, rather than guessing", () => {
    expect(parseZelleEmail("Zelle® update", "Your Zelle activity summary")).toEqual({
      kind: "unreadable",
    });
  });

  it("treats spacing, case and middle initials as the same sender", () => {
    expect(senderKey("RAQUEL M. GARCIA")).toBe(senderKey("Raquel  Garcia"));
  });
});

describe("matching a payment to a family", () => {
  it("records it when the name and amount both line up", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });

    const result = await ingestZelleEmail(db, email("RAQUEL M GARCIA sent you $100.00"));

    expect(result.outcome).toBe("matched");
    const [inv] = await invoices(parentId);
    expect(inv.status).toBe("paid");
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0].method).toBe("zelle");
  });

  it("records an email once, however many times the script sends it", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });
    const e = email("Raquel Garcia sent you $100.00");

    await ingestZelleEmail(db, e);
    const again = await ingestZelleEmail(db, e);

    expect(again.outcome).toBe("duplicate");
    const [inv] = await invoices(parentId);
    expect(inv.payments).toHaveLength(1);
  });

  it("pays two children's invoices from one payment covering both", async () => {
    const { parentId } = await family({ first: "Star", last: "Okafor" }, ["Ada", "Obi"]);

    await ingestZelleEmail(db, email("Star Okafor sent you $200.00"));

    const all = await invoices(parentId);
    expect(all.map((i) => i.status)).toEqual(["paid", "paid"]);
  });

  it("pays the oldest month first", async () => {
    const thisMonth = businessMonth();
    const { parentId } = await family({ first: "Yoomi", last: "Park" }, ["Jin"], [
      thisMonth,
      monthAfter(thisMonth),
    ]);

    await ingestZelleEmail(db, email("Yoomi Park sent you $100.00"));

    const [older, newer] = await invoices(parentId);
    expect(older.status).toBe("paid");
    expect(newer.status).not.toBe("paid");
  });

  it("asks rather than guesses when the amount doesn't fit what's owed", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });

    const result = await ingestZelleEmail(db, email("Raquel Garcia sent you $150.00"));

    expect(result.outcome).toBe("unmatched");
    const r = await receipt((result as any).receiptId);
    // The best guess is kept so the owner only has to confirm it.
    expect(r.parent_id).toBe(parentId);
    expect(r.note).toMatch(/\$150\.00 doesn't match/);
    const [inv] = await invoices(parentId);
    expect(inv.payments).toHaveLength(0);
  });

  it("asks when it doesn't know the sender", async () => {
    await family({ first: "Raquel", last: "Garcia" });

    const result = await ingestZelleEmail(db, email("Miguel Garcia sent you $100.00"));

    expect(result.outcome).toBe("unmatched");
    expect((await receipt((result as any).receiptId)).note).toMatch(/No parent on file/);
  });

  it("asks when two parents share the sender's name", async () => {
    await family({ first: "Maria", last: "Lopez" });
    await family({ first: "Maria", last: "Lopez" });

    const result = await ingestZelleEmail(db, email("Maria Lopez sent you $100.00"));

    expect(result.outcome).toBe("unmatched");
  });

  it("does not offer a payment an invoice whose bank debit is already on its way", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });
    const [inv] = await invoices(parentId);
    await admin
      .from("invoices")
      .update({ status: "processing", autopay_status: "processing" })
      .eq("id", inv.id);

    const result = await ingestZelleEmail(db, email("Raquel Garcia sent you $100.00"));

    expect(result.outcome).toBe("unmatched");
    expect((await invoices(parentId))[0].payments).toHaveLength(0);
  });

  it("leaves her own outgoing payments out of the inbox entirely", async () => {
    const result = await ingestZelleEmail(db, email("You sent $40.00 to Coach Store"));

    expect(result.outcome).toBe("skipped");
    const { count } = await admin.from("zelle_receipts").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("keeps an email it couldn't read, so a real payment isn't silently lost", async () => {
    const result = await ingestZelleEmail(db, email("Zelle® notice", "Something changed with Zelle"));

    expect(result.outcome).toBe("unreadable");
  });
});

describe("an alert forwarded twice", () => {
  it("is held for the owner instead of being recorded a second time", async () => {
    // A re-forward is a new email with a new id, so only the sender and amount
    // can tell it apart from a second payment.
    const { parentId } = await family({ first: "Raquel", last: "Garcia" }, ["Mia", "Leo"]);
    await ingestZelleEmail(db, email("Raquel Garcia sent you $100.00"));

    const again = await ingestZelleEmail(db, email("Fwd: Raquel Garcia sent you $100.00"));

    expect(again.outcome).toBe("unmatched");
    const r = await receipt((again as any).receiptId);
    expect(r.note).toMatch(/Looks like a repeat of the \$100\.00 from Raquel Garcia.*already recorded/);
    expect(r.parent_id).toBe(parentId);
    const paid = (await invoices(parentId)).filter((i) => i.status === "paid");
    expect(paid).toHaveLength(1);
  });

  it("still records the same amount from the same family a month later", async () => {
    const thisMonth = businessMonth();
    await family({ first: "Raquel", last: "Garcia" }, ["Mia"], [thisMonth, monthAfter(thisMonth)]);
    await ingestZelleEmail(db, email("Raquel Garcia sent you $100.00"));

    const nextMonth = await ingestZelleEmail(db, {
      ...email("Raquel Garcia sent you $100.00"),
      receivedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    expect(nextMonth.outcome).toBe("matched");
  });
});

describe("the owner confirming who paid", () => {
  it("records it and remembers the sender for next time", async () => {
    const thisMonth = businessMonth();
    const { parentId } = await family({ first: "Raquel", last: "Garcia" }, ["Mia"], [
      thisMonth,
      monthAfter(thisMonth),
    ]);

    // Her husband's account.
    const first = await ingestZelleEmail(db, email("Miguel Garcia sent you $100.00"));
    expect(first.outcome).toBe("unmatched");

    const confirmed = await matchZelleReceipt((first as any).receiptId, parentId);
    expect(confirmed).toMatchObject({ success: true });

    // Next month, nobody has to do anything.
    const second = await ingestZelleEmail(db, {
      ...email("MIGUEL GARCIA sent you $100.00"),
      receivedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(second.outcome).toBe("matched");

    expect((await invoices(parentId)).map((i) => i.status)).toEqual(["paid", "paid"]);
  });

  it("says when more came in than was owed, rather than losing track of it", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });
    const r = await ingestZelleEmail(db, email("Raquel Garcia sent you $130.00"));

    await matchZelleReceipt((r as any).receiptId, parentId);

    expect((await receipt((r as any).receiptId)).note).toMatch(/\$30\.00 more than was owed/);
    expect((await invoices(parentId))[0].status).toBe("paid");
  });

  it("can undo a wrong match, and forgets the name so it doesn't repeat", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });
    const r = await ingestZelleEmail(db, email("Miguel Garcia sent you $100.00"));
    await matchZelleReceipt((r as any).receiptId, parentId);

    const undone = await undoZelleMatch((r as any).receiptId);

    expect(undone).toMatchObject({ success: true });
    const [inv] = await invoices(parentId);
    expect(inv.payments).toHaveLength(0);
    // Owed again — pending or overdue depending on the day, but not paid.
    expect(inv.status).not.toBe("paid");
    const { data: alias } = await admin
      .from("zelle_senders")
      .select("*")
      .eq("sender_key", senderKey("Miguel Garcia"));
    expect(alias).toHaveLength(0);
  });
});

/**
 * Accented names (issue #23). The name pattern stopped at the first accented
 * letter and the sender key dropped it: "JOSÉ PATEL" was read as "PATEL", that
 * one word was remembered, and RAÚL PATEL's payment then went to José's family.
 */
describe("accented names", () => {
  it("reads the whole name, accents and all", () => {
    expect(parseZelleEmail("JOSÉ PATEL sent you $100.00", "")).toMatchObject({ senderName: "JOSÉ PATEL" });
    expect(parseZelleEmail("Lucía Peña sent you $100.00", "")).toMatchObject({ senderName: "Lucía Peña" });
    expect(parseZelleEmail("Zelle payment", "You received $100.00 from MARÍA NÚÑEZ")).toMatchObject({
      senderName: "MARÍA NÚÑEZ",
    });
  });

  it("treats a name with and without its accents as the same sender", () => {
    expect(senderKey("García")).toBe("garcia");
    expect(senderKey("JOSÉ NÚÑEZ")).toBe(senderKey("Jose Nunez"));
    expect(senderKey("Lucía Peña")).toBe("lucia pena");
  });

  it("matches García, Núñez and Peña to their families, however the bank spells them", async () => {
    const garcia = await family({ first: "María", last: "García" });
    const nunez = await family({ first: "Jose", last: "Nunez" });
    const pena = await family({ first: "Lucía", last: "Peña" });

    expect((await ingestZelleEmail(db, email("MARIA GARCIA sent you $100.00"))).outcome).toBe("matched");
    expect((await ingestZelleEmail(db, email("JOSÉ NÚÑEZ sent you $100.00"))).outcome).toBe("matched");
    expect((await ingestZelleEmail(db, email("Lucía Peña sent you $100.00"))).outcome).toBe("matched");

    for (const f of [garcia, nunez, pena]) expect((await invoices(f.parentId))[0].status).toBe("paid");
  });

  it("does not give one Patel's payment to another", async () => {
    const jose = await family({ first: "José", last: "Patel" });
    const raul = await family({ first: "Raúl", last: "Patel" });

    expect((await ingestZelleEmail(db, email("JOSÉ PATEL sent you $100.00"))).outcome).toBe("matched");
    expect((await ingestZelleEmail(db, email("RAÚL PATEL sent you $100.00"))).outcome).toBe("matched");

    expect((await invoices(jose.parentId))[0].payments).toHaveLength(1);
    expect((await invoices(raul.parentId))[0].payments).toHaveLength(1);
  });

  it("never remembers a single word as a sender", async () => {
    const { parentId } = await family({ first: "José", last: "Patel" });
    const r = await ingestZelleEmail(db, email("PATEL sent you $100.00"));
    expect(r.outcome).toBe("unmatched");

    expect(await matchZelleReceipt((r as any).receiptId, parentId)).toMatchObject({ success: true });

    const { data: remembered } = await admin.from("zelle_senders").select("sender_key");
    expect(remembered).toEqual([]);
  });

  it("does not trust a single word remembered before this was fixed", async () => {
    const jose = await family({ first: "José", last: "Patel" });
    await admin.from("zelle_senders").insert({ sender_key: "patel", parent_id: jose.parentId });

    const r = await ingestZelleEmail(db, email("PATEL sent you $100.00"));

    expect(r.outcome).toBe("unmatched");
    expect((await invoices(jose.parentId))[0].payments).toHaveLength(0);
  });
});

describe("a parent naming the account they pay from", () => {
  it("makes that account's payments match their family", async () => {
    const { parentId, payToken } = await family({ first: "Raquel", last: "Garcia" });

    expect(await rememberZelleName(payToken, "Miguel A. Garcia")).toMatchObject({ success: true });
    const result = await ingestZelleEmail(db, email("Miguel Garcia sent you $100.00"));

    expect(result.outcome).toBe("matched");
    expect((await invoices(parentId))[0].status).toBe("paid");
  });

  it("cannot claim another family's name", async () => {
    // Otherwise anyone with a link could have someone else's payments credited
    // to their own account.
    await family({ first: "Raquel", last: "Garcia" });
    const intruder = await family({ first: "Eve", last: "Smith" });

    const result = await rememberZelleName(intruder.payToken, "Raquel Garcia");

    expect(result).toHaveProperty("error");
  });

  it("does nothing for a token that isn't real", async () => {
    expect(await rememberZelleName("not-a-real-token-at-all-xx", "Some Body")).toHaveProperty("error");
  });
});

describe("the endpoint the Gmail script posts to", () => {
  async function secret() {
    const { data } = await admin
      .from("config")
      .select("value")
      .eq("key", "zelle_inbound_secret")
      .single();
    return data!.value as string;
  }

  function post(body: unknown, key?: string) {
    return inbound(
      new Request("http://localhost/api/inbound/zelle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
      }) as any
    );
  }

  it("records each check-in, so a script that stops is noticed", async () => {
    await admin.from("config").update({ value: "" }).eq("key", "zelle_script_last_seen");
    const before = Date.now();

    const res = await post({ messages: [] }, await secret());

    expect(res.status).toBe(200);
    const { data } = await admin.from("config").select("value").eq("key", "zelle_script_last_seen").single();
    expect(new Date(data!.value).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("turns away anyone without the key", async () => {
    const res = await post({ messages: [] });
    expect(res.status).toBe(401);
    const wrong = await post({ messages: [] }, "nope");
    expect(wrong.status).toBe(401);
  });

  it("records a batch, and a repeat of it is harmless", async () => {
    const { parentId } = await family({ first: "Raquel", last: "Garcia" });
    const key = await secret();
    const batch = {
      messages: [
        { id: "gm-1", subject: "Raquel Garcia sent you $100.00", text: "", receivedAt: new Date().toISOString() },
        { id: "gm-2", subject: "You sent $20.00 to Pizza Place", text: "" },
      ],
    };

    const first = await (await post(batch, key)).json();
    const second = await (await post(batch, key)).json();

    expect(first).toMatchObject({ matched: 1, skipped: 1 });
    expect(second).toMatchObject({ duplicate: 1, skipped: 1 });
    expect((await invoices(parentId))[0].payments).toHaveLength(1);
  });
});
