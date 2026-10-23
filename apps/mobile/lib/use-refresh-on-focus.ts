/**
 * Refetch a screen's data when it regains navigation focus (tab switch, back
 * navigation).
 *
 * TanStack's `refetchOnWindowFocus` is bridged to AppState only
 * (data/query-client.ts), so switching Chat → Issues never refetched, and a
 * list could stay behind until pull-to-refresh. This hook fires on the
 * unfocused → focused edge (not on first mount; the mount fetch covers that)
 * and refetches only the queries `needsFocusRefresh` selects: invalidated,
 * fetched before the current socket came up, socket down, or older than the
 * max age. With a healthy socket and fresh data it makes no request — no
 * polling.
 *
 * While the screen is mounted but not focused (back stack, background tab),
 * its keys are parked: a socket reconnect then only marks them
 * stale, and the screen refetches them here once it regains focus, instead
 * of every stacked screen refetching at the same moment.
 *
 * Focus is tracked through navigation `focus`/`blur` listeners, not
 * `useIsFocused()`: that one is React state and re-rendered the whole screen
 * on every push on top of it (see lib/focus-refresh-tracker.ts).
 */
import { useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useWSClient } from "@/data/realtime/realtime-provider";
import { refreshOnFocus } from "@/data/realtime/live-refresh";
import {
  parkFocusKeys,
  unparkFocusKeys,
} from "@/data/realtime/reconnect-refresh";
import {
  createFocusRefreshTracker,
  type FocusRefreshTracker,
} from "@/lib/focus-refresh-tracker";

export function useRefreshOnFocus(queryKeys: readonly QueryKey[]) {
  const qc = useQueryClient();
  const ws = useWSClient();
  const navigation = useNavigation();
  // Latest client/socket for the listener without re-subscribing.
  const deps = useRef({ qc, ws });
  deps.current = { qc, ws };
  const screen = useRef<symbol | null>(null);
  screen.current ??= Symbol("focus-screen");
  const tracker = useRef<FocusRefreshTracker | null>(null);
  tracker.current ??= createFocusRefreshTracker({
    initialFocused: navigation.isFocused(),
    initialKeys: queryKeys,
    park: (keys, focused) => parkFocusKeys(screen.current!, keys, focused),
    onRegain: (keys) =>
      refreshOnFocus(deps.current.qc, keys, deps.current.ws?.connectedSince() ?? null),
  });

  // Every render: keys may change with the route params.
  useEffect(() => {
    tracker.current!.setKeys(queryKeys);
  });
  useEffect(() => {
    const t = tracker.current!;
    // Focus may have moved between render and subscribe.
    if (navigation.isFocused()) t.focus();
    else t.blur();
    const offFocus = navigation.addListener("focus", () => t.focus());
    const offBlur = navigation.addListener("blur", () => t.blur());
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  useEffect(() => {
    const token = screen.current!;
    return () => unparkFocusKeys(token);
  }, []);
}
