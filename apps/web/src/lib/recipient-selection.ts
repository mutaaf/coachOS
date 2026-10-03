/**
 * Who a message in Compose goes to.
 *
 * The recipients shown must always be the ones for the group she can see
 * picked. Switching between All Parents, By School and By Program once kept
 * the last school's parents loaded under a different program's name, and a
 * message for one school went to another's families. So every change of mode
 * or group clears what was loaded, a list that arrives for a group she has
 * since moved off is dropped, and Send waits until the two match.
 */

export type RecipientMode = "all" | "school" | "program";

export interface Recipient {
  phone: string;
  name: string;
}

export interface RecipientSelection {
  mode: RecipientMode;
  /** The school or program picked in the dropdown; "" until she picks one. */
  selectedId: string;
  recipients: Recipient[];
  /** The group `recipients` were loaded for, or null if nothing is loaded. */
  loadedFor: string | null;
}

export type RecipientEvent =
  | { type: "mode"; mode: RecipientMode }
  | { type: "select"; id: string }
  | { type: "loaded"; key: string; recipients: Recipient[] }
  | { type: "clear" };

export const initialSelection: RecipientSelection = {
  mode: "all",
  selectedId: "",
  recipients: [],
  loadedFor: null,
};

/** The group currently picked on screen, or null if a school/program is still to be chosen. */
export function selectionKey(s: Pick<RecipientSelection, "mode" | "selectedId">): string | null {
  if (s.mode === "all") return "all";
  return s.selectedId ? `${s.mode}:${s.selectedId}` : null;
}

export function recipientReducer(state: RecipientSelection, event: RecipientEvent): RecipientSelection {
  switch (event.type) {
    case "mode":
      return { mode: event.mode, selectedId: "", recipients: [], loadedFor: null };
    case "select":
      return { ...state, selectedId: event.id, recipients: [], loadedFor: null };
    case "loaded":
      // A slow answer for a group she has since moved off is thrown away.
      if (event.key !== selectionKey(state)) return state;
      return { ...state, recipients: event.recipients, loadedFor: event.key };
    case "clear":
      return { ...state, selectedId: "", recipients: [], loadedFor: null };
  }
}

/** The recipients a send may go to: only those loaded for the group on screen. */
export function sendableRecipients(state: RecipientSelection): Recipient[] {
  const key = selectionKey(state);
  if (key === null || state.loadedFor !== key) return [];
  return state.recipients;
}
