/**
 * Focus bookkeeping behind `useRefreshOnFocus`, kept out of React
 * state: a `useIsFocused()` state flip re-rendered the whole screen on every
 * blur/focus — the Inbox tab re-rendered (~40 ms, up to 240 ms under load)
 * each time an issue chat was pushed on top of it. The hook now feeds
 * navigation `focus`/`blur` events in here; nothing re-renders.
 *
 * - `setKeys` (every render): keys may change with the route params; re-park
 *   them under the current focus state.
 * - `focus` / `blur`: park or unpark the keys; on the unfocused → focused
 *   edge (not the initial focus) call `onRegain` so the screen refetches.
 */
import type { QueryKey } from "@tanstack/react-query";

export interface FocusRefreshTracker {
  setKeys(keys: readonly QueryKey[]): void;
  focus(): void;
  blur(): void;
  isFocused(): boolean;
}

export function createFocusRefreshTracker(opts: {
  initialFocused: boolean;
  initialKeys: readonly QueryKey[];
  park: (keys: readonly QueryKey[], focused: boolean) => void;
  onRegain: (keys: readonly QueryKey[]) => void;
}): FocusRefreshTracker {
  let focused = opts.initialFocused;
  let keys = opts.initialKeys;
  return {
    setKeys(next) {
      keys = next;
      opts.park(keys, focused);
    },
    focus() {
      if (focused) return;
      focused = true;
      opts.park(keys, true);
      opts.onRegain(keys);
    },
    blur() {
      if (!focused) return;
      focused = false;
      opts.park(keys, false);
    },
    isFocused: () => focused,
  };
}
