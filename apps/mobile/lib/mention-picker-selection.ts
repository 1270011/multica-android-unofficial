/**
 * Text helpers for the @-sheet's selection bar (W3-P2).
 * Pure so the labels and TalkBack phrases are
 * unit-testable without rendering the sheet.
 */
import type { MentionChipDraft } from "@/data/stores/mention-draft-store";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Visible chip text, same as the composer's chip row: issues show the
 *  bare identifier, everything else a leading `@`. */
export function mentionChipLabel(
  m: Pick<MentionChipDraft, "type" | "name">,
): string {
  return m.type === "issue" ? m.name : `@${m.name}`;
}

/** Name spoken by TalkBack (no `@`, which it would read as "at"). */
export function mentionSpokenName(
  m: Pick<MentionChipDraft, "type" | "name">,
): string {
  return m.type === "all" ? "all" : m.name;
}

/** Announcement after a row or chip toggled. `countAfter` is the number
 *  selected once the toggle has been applied. */
export function mentionToggleAnnouncement(
  t: Translate,
  m: Pick<MentionChipDraft, "type" | "name">,
  added: boolean,
  countAfter: number,
): string {
  return t(added ? "picker.added_a11y" : "picker.removed_a11y", {
    name: mentionSpokenName(m),
    count: countAfter,
  });
}

/** "Done (n)" button text; plain "Done" while nothing is selected. */
export function mentionDoneLabel(t: Translate, count: number): string {
  return count > 0 ? t("picker.done_count", { count }) : t("picker.done");
}

/** W3-P3: after a pick made with search text the field is emptied, so the
 *  next name can be typed right away. Only on add — unticking a match
 *  keeps the query (the user is still looking at that result set). A
 *  whitespace-only query counts as empty, like the filter itself. */
export function shouldClearQueryAfterToggle(
  query: string,
  added: boolean,
): boolean {
  return added && query.trim().length > 0;
}

/** W3-P3: the selection bar appears (first pick) or disappears (last chip
 *  removed) above the list and shifts it by its height. To keep the row
 *  under the finger where it was, scroll by the same amount, at the top
 *  too: the first pick is usually made there, and a quick second tap hit
 *  the row above (F5, A3.2). The result never goes below 0;
 *  `null` means there is nothing to scroll. */
export function compensateScrollForBar(
  offset: number,
  oldBarHeight: number,
  newBarHeight: number,
): number | null {
  const delta = newBarHeight - oldBarHeight;
  if (delta === 0) return null;
  const target = Math.max(0, Math.max(0, offset) + delta);
  return target === offset ? null : target;
}

/** The formSheet header (and with it the native search bar)
 *  only renders on iOS. Everywhere else the @-sheet puts its own search
 *  field into the body, above the chip bar. */
export function mentionSearchInBody(os: string): boolean {
  return os !== "ios";
}

/** The @-sheet opens only at the tall detent. Its content
 *  (search, chip bar, list, pinned "Done (n)") is laid out for 0.95; at
 *  0.6 the Done bar sat below the visible part of the sheet (A3.4). */
export const MENTION_SHEET_DETENTS = [0.95];

/** On Android the formSheet does not move or shrink for the
 *  keyboard, so the pinned "Done (n)" ended up behind it. A spacer of the
 *  keyboard's height under the Done bar lifts it above the keyboard (the
 *  list shrinks instead). iOS sheets handle the keyboard natively. */
export function mentionKeyboardSpacer(
  os: string,
  keyboardVisible: boolean,
  keyboardHeight: number,
  bottomInset = 0,
): number {
  if (os === "ios" || !keyboardVisible) return 0;
  // The reported height includes the nav bar strip, which the sheet's
  // content already ends above (measured on an emulator: a gap of exactly the
  // inset otherwise).
  return Math.max(0, keyboardHeight - bottomInset);
}
