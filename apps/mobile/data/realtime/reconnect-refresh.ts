/**
 * Reconnect refresh — refetch only what is on screen.
 *
 * Stack screens stay mounted. When every reconnect handler invalidated its
 * keys with a refetch, each issue in the back stack reloaded detail,
 * timeline, tasks, attachments … on every return from the background (~10x
 * the CPU of the old app in simpleperf). Now a handler calls
 * `invalidateAfterReconnect`: everything is marked stale, but only queries
 * that no unfocused screen has parked refetch at once. `useRefreshOnFocus`
 * parks a screen's keys while it is not focused and refetches them once on
 * the next focus (`needsFocusRefresh`: invalidated).
 *
 * Pure (TanStack only), so realtime updaters and their tests can import it
 * without React Native.
 */
import {
  partialMatchKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

/** Query keys of screens that are mounted but not focused, per screen. Only
 *  `useRefreshOnFocus` writes here; a screen's entry is removed when it
 *  regains focus or unmounts. */
const parkedScreens = new Map<symbol, readonly QueryKey[]>();
/** Keys of focused screens. A query that a focused screen also shows (the
 *  same issue twice in the stack) must not be deferred. */
const focusedScreens = new Map<symbol, readonly QueryKey[]>();

/** Record a screen's keys and whether it is focused. */
export function parkFocusKeys(
  screen: symbol,
  queryKeys: readonly QueryKey[],
  focused: boolean,
) {
  (focused ? parkedScreens : focusedScreens).delete(screen);
  (focused ? focusedScreens : parkedScreens).set(screen, queryKeys);
}

/** Forget a screen (unmount). */
export function unparkFocusKeys(screen: symbol) {
  parkedScreens.delete(screen);
  focusedScreens.delete(screen);
}

function matchesAny(
  queryKey: QueryKey,
  screens: Map<symbol, readonly QueryKey[]>,
): boolean {
  for (const keys of screens.values()) {
    if (keys.some((k) => partialMatchKey(queryKey, k))) return true;
  }
  return false;
}

/** Is this query shown only by screens that are not focused right now? */
export function isParked(queryKey: QueryKey): boolean {
  return matchesAny(queryKey, parkedScreens) && !matchesAny(queryKey, focusedScreens);
}

/**
 * Reconnect handler for a key prefix: mark every query under it stale (no
 * request), then refetch at once only the active ones that are not parked.
 * Parked queries stay invalidated, so `useRefreshOnFocus` refetches them on
 * the next focus; inactive ones refetch on their next mount. Several
 * handlers may cover the same query (the global issues prefix and the
 * per-issue hook); `cancelRefetch: false` joins the running request instead
 * of cancelling and restarting it.
 */
export function invalidateAfterReconnect(qc: QueryClient, queryKey: QueryKey) {
  void qc.invalidateQueries({ queryKey, refetchType: "none" });
  void qc.refetchQueries(
    {
      queryKey,
      type: "active",
      predicate: (q) => q.state.isInvalidated && !isParked(q.queryKey),
    },
    { cancelRefetch: false },
  );
}

/** Test helper: drop all screen registrations. */
export function resetParkedFocusKeys() {
  parkedScreens.clear();
  focusedScreens.clear();
}
