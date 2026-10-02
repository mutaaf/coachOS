import type { OpsClient } from "@/lib/supabase/types";
import {
  openInvoicesForFamily,
  recalculateInvoiceStatus,
  type OpenInvoice,
} from "@/lib/invoice-status";

/**
 * Zelle has no API. What it does have is the email every bank sends when money
 * arrives, so that is what this reads.
 *
 * The rule for recording a payment without asking is deliberately narrow: the
 * sender must resolve to exactly one family, and the amount must exactly cover
 * that family's oldest open invoices. Anything less certain is put in front of
 * the owner instead, with the best guess filled in. Money recorded against the
 * wrong child is worse than money waiting a day to be confirmed.
 */

export interface ZelleEmail {
  messageId: string;
  subject: string;
  text: string;
  receivedAt?: string;
}

export type ParsedZelle =
  | { kind: "incoming"; senderName: string; amount: number; memo: string | null }
  | { kind: "outgoing" }
  | { kind: "unreadable" };

// A name as banks print it: capitalised words, upper or title case, with the
// odd initial, hyphen or apostrophe. Requiring capitals is what stops "Hi Anum,
// Raquel Garcia sent you" from reading the greeting as part of the name.
const NAME = String.raw`([A-Z][A-Za-z'’.\-]*(?: [A-Z][A-Za-z'’.\-]*){0,4})`;
const AMOUNT = String.raw`\$\s?([\d,]+(?:\.\d{2})?)`;

const INCOMING: { re: RegExp; name: number; amount: number | null }[] = [
  // Bank of America, Chase and most others: "Raquel Garcia sent you $100.00"
  { re: new RegExp(`${NAME} (?:has )?sent you ${AMOUNT}`), name: 1, amount: 2 },
  // Chase's newer layout: "Raquel Garcia sent you money", amount on its own line
  { re: new RegExp(`${NAME} (?:has )?sent you money`), name: 1, amount: null },
  // Wells Fargo, Capital One: "You received $100.00 from RAQUEL GARCIA"
  {
    re: new RegExp(`[Yy]ou(?:'ve| have)? received ${AMOUNT}(?: with Zelle®?| via Zelle®?)? from ${NAME}`),
    name: 2,
    amount: 1,
  },
  // "...deposited $100.00 from Raquel Garcia"
  { re: new RegExp(`deposited ${AMOUNT}(?: [a-z ]+)? from ${NAME}`), name: 2, amount: 1 },
];

// Her own Zelle activity arrives in the same inbox: money she sent, money she
// asked for. Neither is a family paying.
const OUTGOING = /\byou(?:'ve)? sent\b|\bpayment to\b|\brequest(?:ed)?\b|\byou paid\b/i;

function clean(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}

function tidyName(raw: string): string {
  // A trailing "." is the end of a sentence, not an initial.
  return raw.replace(/[.\s]+$/, "").trim();
}

export function parseZelleEmail(subject: string, body: string): ParsedZelle {
  const s = clean(subject || "");
  const text = `${s}\n${clean(body || "")}`;

  if (OUTGOING.test(s)) return { kind: "outgoing" };

  for (const pattern of INCOMING) {
    const m = text.match(pattern.re);
    if (!m) continue;

    let amountText = pattern.amount ? m[pattern.amount] : undefined;
    if (!amountText) {
      amountText = text.match(new RegExp(`Amount:?\\s*${AMOUNT}`, "i"))?.[1];
    }
    if (!amountText) continue;

    const amount = Number(amountText.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const memo = text.match(/^(?:Memo|Message|Note)\s*:?\s*(.+)$/im)?.[1]?.trim() || null;

    return { kind: "incoming", senderName: tidyName(m[pattern.name]), amount, memo };
  }

  // Only the plainest signal is trusted in the body: footers on incoming emails
  // carry links like "Request money", which must not hide one that failed to read.
  if (/\byou(?:'ve)? sent\b/i.test(text)) return { kind: "outgoing" };
  return { kind: "unreadable" };
}

/** "RAQUEL M. GARCIA" and "Raquel Garcia" are the same sender. */
export function senderKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1)
    .join(" ");
}

type SenderMatch =
  | { parentId: string; via: "known" | "name" }
  | { parentId: null; reason: string; guessId?: string };

/** Work out which family a sender is, if it can be said with certainty. */
export async function findSender(supabase: OpsClient, senderName: string): Promise<SenderMatch> {
  const key = senderKey(senderName);
  if (!key) return { parentId: null, reason: "The email had no sender name." };

  const { data: known } = await supabase
    .from("zelle_senders")
    .select("parent_id")
    .eq("sender_key", key)
    .maybeSingle();
  if (known) return { parentId: known.parent_id, via: "known" };

  // First and last word, ignoring middle names and initials either side.
  const tokens = key.split(" ");
  const first = tokens[0];
  const last = tokens[tokens.length - 1];

  const { data: parents } = await supabase.from("parents").select("id, first_name, last_name");
  const matches = (parents || []).filter((p) => {
    const pf = senderKey(p.first_name).split(" ")[0];
    const pl = senderKey(p.last_name).split(" ").pop();
    return pf === first && pl === last;
  });

  if (matches.length === 1) return { parentId: matches[0].id, via: "name" };
  if (matches.length > 1) {
    return { parentId: null, reason: `More than one parent is called ${senderName}.` };
  }
  return {
    parentId: null,
    reason: `No parent on file is called ${senderName} — it may be a spouse or another account.`,
  };
}

export interface Allocation {
  invoice: OpenInvoice;
  cents: number;
}

/**
 * The oldest invoices whose balances add up to exactly this amount, or null.
 *
 * $100 from a family owing two $100 invoices pays the older one; $200 pays
 * both. $150 is not a whole number of invoices, so it is a question for the
 * owner rather than a guess.
 */
export function allocateExactly(open: OpenInvoice[], cents: number): Allocation[] | null {
  const picked: Allocation[] = [];
  let total = 0;
  for (const invoice of open) {
    picked.push({ invoice, cents: invoice.balanceCents });
    total += invoice.balanceCents;
    if (total === cents) return picked;
    if (total > cents) return null;
  }
  return null;
}

/** Oldest first, as far as the money goes. Used once the owner has said who paid. */
export function allocateGreedily(open: OpenInvoice[], cents: number) {
  const picked: Allocation[] = [];
  let remaining = cents;
  for (const invoice of open) {
    if (remaining <= 0) break;
    const take = Math.min(invoice.balanceCents, remaining);
    picked.push({ invoice, cents: take });
    remaining -= take;
  }
  return { picked, leftoverCents: remaining };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Record a receipt's money against invoices and mark it matched. */
export async function applyReceipt(
  supabase: OpsClient,
  receipt: { id: string; sender_name: string | null; received_at: string; memo: string | null },
  parentId: string,
  allocations: Allocation[],
  note: string | null = null
) {
  for (const { invoice, cents } of allocations) {
    const { error } = await supabase.from("payments").insert({
      invoice_id: invoice.id,
      amount: cents / 100,
      method: "zelle",
      reference: `Zelle from ${receipt.sender_name}`,
      received_at: receipt.received_at,
      notes: receipt.memo,
      zelle_receipt_id: receipt.id,
    });
    if (error) return { error: error.message };
    await recalculateInvoiceStatus(supabase, invoice.id);
  }

  const { error } = await supabase
    .from("zelle_receipts")
    .update({ status: "matched", parent_id: parentId, note })
    .eq("id", receipt.id);
  if (error) return { error: error.message };

  return { success: true as const };
}

export type IngestResult =
  | { outcome: "duplicate" | "skipped" }
  | { outcome: "matched" | "unmatched" | "unreadable"; receiptId: string };

/** Take one bank email from the inbox to a recorded payment, or to the owner. */
export async function ingestZelleEmail(
  supabase: OpsClient,
  email: ZelleEmail
): Promise<IngestResult> {
  const parsed = parseZelleEmail(email.subject, email.text);
  if (parsed.kind === "outgoing") return { outcome: "skipped" };

  const base = {
    message_id: email.messageId,
    subject: email.subject?.slice(0, 500) ?? null,
    body: email.text?.slice(0, 5000) ?? null,
    received_at: email.receivedAt ?? new Date().toISOString(),
  };

  const row: Record<string, unknown> =
    parsed.kind === "unreadable"
      ? {
          ...base,
          status: "unreadable",
          note: "Couldn't find a sender and amount in this email. If it's a payment, record it by hand.",
        }
      : {
          ...base,
          sender_name: parsed.senderName,
          amount: parsed.amount,
          memo: parsed.memo,
          status: "unmatched",
        };

  // The forwarding script re-sends recent emails every run; the unique message
  // id turns a repeat into a no-op rather than a second payment.
  const { data: inserted, error } = await supabase
    .from("zelle_receipts")
    .upsert(row, { onConflict: "message_id", ignoreDuplicates: true })
    .select("id, sender_name, received_at, memo")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!inserted) return { outcome: "duplicate" };
  if (parsed.kind === "unreadable") return { outcome: "unreadable", receiptId: inserted.id };

  const sender = await findSender(supabase, parsed.senderName);
  if (sender.parentId === null) {
    await supabase.from("zelle_receipts").update({ note: sender.reason }).eq("id", inserted.id);
    return { outcome: "unmatched", receiptId: inserted.id };
  }

  const cents = Math.round(parsed.amount * 100);
  const open = await openInvoicesForFamily(supabase, sender.parentId);
  const allocation = allocateExactly(open, cents);

  if (!allocation) {
    const owed = open.reduce((s, i) => s + i.balanceCents, 0);
    const reason =
      open.length === 0
        ? "This family has nothing open to pay."
        : `${dollars(cents)} doesn't match what this family owes (${dollars(owed)} open).`;
    await supabase
      .from("zelle_receipts")
      .update({ parent_id: sender.parentId, note: reason })
      .eq("id", inserted.id);
    return { outcome: "unmatched", receiptId: inserted.id };
  }

  const applied = await applyReceipt(supabase, inserted, sender.parentId, allocation);
  if ("error" in applied) throw new Error(applied.error);
  return { outcome: "matched", receiptId: inserted.id };
}
