/**
 * Width a table may use inside a chat bubble or comment card.
 * Computed from the pane width and the known paddings instead of measuring
 * each message, so `chooseTableLayout` runs once per message and width and
 * the chat does not jump while it scrolls. The grid lays its columns out in
 * proportions, so being a few dp off never clips a cell.
 */

/** Issue chat: list `px-3` + bubble `px-3.5` + `border-2` on both sides. */
export const CHAT_BUBBLE_INSET = 2 * (12 + 14 + 2);
/** Activity: card wrapper `px-4` + card `px-4` + `border-2` on both sides. */
export const COMMENT_CARD_INSET = 2 * (16 + 16 + 2);
/** Any other markdown surface without a known width (description, AI chat). */
export const DEFAULT_MARKDOWN_INSET = 32;

export function chatBubbleContentWidth(paneWidth: number): number {
  return Math.max(0, paneWidth - CHAT_BUBBLE_INSET);
}

export function commentCardContentWidth(paneWidth: number): number {
  return Math.max(0, paneWidth - COMMENT_CARD_INSET);
}
