import { hasLeftoverBraces, renderTemplate, templateVariables } from "shared";

/**
 * Compose knows each recipient's name and nothing else, so {{parent_name}} is
 * the one variable it can fill. Shared by the page (its chips and preview) and
 * sendBulkMessages (which refuses anything else), so the two can't disagree —
 * Compose once offered eleven chips and accepted only this one.
 */
export const COMPOSE_VARIABLES = ["parent_name"] as const;

/** The first name a group message greets a parent by. */
export function composeFirstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "there";
}

/** The message one parent would receive. */
export function renderComposed(message: string, recipientName: string | null | undefined): string {
  return renderTemplate(message, { parent_name: composeFirstName(recipientName) });
}

/**
 * Why a group message can't go out as written, or null when it can. A parent
 * must never receive a raw "{{student_name}}" or a half-typed "{{parent_name}".
 */
export function composeProblem(message: string): string | null {
  const unknown = templateVariables(message).filter((v) => !(COMPOSE_VARIABLES as readonly string[]).includes(v));
  if (unknown.length) {
    return `A message to a group can only fill in {{parent_name}}. Remove ${unknown.map((v) => `{{${v}}}`).join(", ")} or write it out.`;
  }
  if (hasLeftoverBraces(renderComposed(message, "there"))) {
    return "Part of the message is still in {{ }} braces. Fix or remove them so it reads the way parents should see it.";
  }
  return null;
}
