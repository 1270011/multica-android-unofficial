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

/** Left pane width in dp, never narrower than a phone column. */
export function leftPaneWidth(width: number): number {
  return Math.max(360, Math.round(width * LEFT_PANE_RATIO));
}

/**
 * Right pane plus the T5 read permission of the embedded chat (docs/UX.md
 * §8.5). Opening the detail shows the chat but marks nothing read — the
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
