/**
 * Issue detail on tablets: with
 * `useBreakpoint().twoPane` (lib/breakpoints.ts) the detail shows two
 * panes — issue head and description on the left, the issue chat on the
 * right with a "Chat | Activity" switch, chat by default. Phones (also in
 * landscape) keep the single list.
 */
export type DetailPane = "chat" | "activity";
export const DEFAULT_DETAIL_PANE: DetailPane = "chat";

/** Share of the width for the left pane; the chat gets the rest. */
export const LEFT_PANE_RATIO = 0.42;
/** The left pane wants this much on medium widths … */
export const LEFT_PANE_PREFERRED_DP = 360;
/** … but neither pane gets less than this. */
export const MIN_PANE_DP = 280;

/**
 * Left pane width in dp. Wide windows split 42 / 58; on medium widths the
 * left pane gets up to 360 dp but never more than half, so the chat keeps at
 * least as much (600 dp → 300 / 300, 800 dp → 360 / 440, 1280 dp → 538 / 742).
 */
export function leftPaneWidth(width: number): number {
  const preferred = Math.min(LEFT_PANE_PREFERRED_DP, Math.floor(width / 2));
  const left = Math.max(preferred, Math.round(width * LEFT_PANE_RATIO));
  return Math.max(MIN_PANE_DP, Math.min(left, width - MIN_PANE_DP));
}

/**
 * Right pane plus the T5 read permission of the embedded chat.
 * Opening the detail shows the chat but marks nothing read — the
 * detail may come from a deep link. Only an explicit tap on "Chat" (pill
 * or "Open as chat") allows it, for as long as this detail stays open.
 */
export interface DetailPaneState {
  pane: DetailPane;
  chatReadAllowed: boolean;
}

export const INITIAL_DETAIL_PANE_STATE: DetailPaneState = {
  pane: DEFAULT_DETAIL_PANE,
  chatReadAllowed: false,
};

/** The user tapped `pane`. */
export function selectDetailPane(state: DetailPaneState, pane: DetailPane): DetailPaneState {
  const chatReadAllowed = state.chatReadAllowed || pane === "chat";
  if (state.pane === pane && state.chatReadAllowed === chatReadAllowed) return state;
  return { pane, chatReadAllowed };
}
