import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { RosterRow } from "@/lib/roster";

/**
 * Reads a roster out of whatever the owner has: screenshots of a spreadsheet,
 * a sign-up sheet, a WhatsApp group's member list, a photo of a paper list, or
 * text pasted from anywhere.
 *
 * It only transcribes. The owner sees every row and corrects it before
 * anything is saved, so the instruction that matters most is not to invent:
 * a blank field is a question for her; a made-up phone number is a parent who
 * never gets a message.
 */

export const MODEL = "claude-opus-5-5";

const Row = z.object({
  child_first_name: z.string().nullable(),
  child_last_name: z.string().nullable(),
  grade: z.string().nullable(),
  parent_first_name: z.string().nullable(),
  parent_last_name: z.string().nullable(),
  parent_phone: z.string().nullable(),
  parent_email: z.string().nullable(),
  uncertain: z.array(
    z.enum([
      "child_first_name",
      "child_last_name",
      "grade",
      "parent_first_name",
      "parent_last_name",
      "parent_phone",
      "parent_email",
    ])
  ),
});

const Roster = z.object({
  rows: z.array(Row),
  notes: z.array(z.string()),
});

const INSTRUCTIONS = `You are reading the roster for one session of a youth sports program, so the owner doesn't have to type it in. What you return goes onto a review screen where she checks every row before anything is saved.

Return one row per child. A parent with two children on the list is two rows with the same parent details.

The source may be a spreadsheet, a sign-up form export, a photo of a paper list, or a WhatsApp group's participant list. A WhatsApp member list shows parents (a name or just a phone number), not children: return one row per parent with the child fields null. A child's last name is usually the family's surname, so fill it from the parent's when the list only gives the child's first name, and add "child_last_name" to that row's uncertain list.

Transcribe; never invent. If a field is not on the page, return null. If you can read it but are not sure (blurry, cut off, ambiguous handwriting), give your best reading and name the field in that row's "uncertain" list. Copy phone numbers digit for digit as shown. Skip the owner's own entries ("You", "Admin", the business) and header rows.

Put anything the owner should know in "notes", in one short sentence each: a part of the image that was cut off, rows you could not read at all, a total that doesn't match the rows you found.`;

export interface RosterInput {
  images: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[];
  text?: string | null;
}

export interface ReadResult {
  rows: RosterRow[];
  notes: string[];
}

export async function readRoster(input: RosterInput, client: Anthropic = new Anthropic()): Promise<ReadResult> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...input.images.map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      })
    ),
  ];
  if (input.text?.trim()) {
    content.push({ type: "text", text: `<pasted>\n${input.text.trim()}\n</pasted>` });
  }
  content.push({ type: "text", text: "Read the roster from the above." });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Transcription, not reasoning — but a misread digit costs a family their
    // messages, so not the lowest setting either.
    output_config: { effort: "medium", format: betaZodOutputFormat(Roster) },
    // If the request is declined, retry on the model the API picks rather than
    // leaving the owner with an error.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: INSTRUCTIONS,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The roster couldn't be read. Try a CSV, or paste the names in instead.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("That roster was too long to read in one go. Try fewer screenshots at a time.");
  }

  return { rows: response.parsed_output.rows, notes: response.parsed_output.notes };
}
