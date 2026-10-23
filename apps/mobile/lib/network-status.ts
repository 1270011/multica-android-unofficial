/**
 * App-wide connectivity signal.
 *
 * TanStack Query already bridges NetInfo into its `onlineManager`
 * (data/query-client.ts) so queries pause while offline — but nothing told
 * the USER. This module keeps the same NetInfo state in a tiny Zustand store
 * so UI can render an offline banner (`ConnectivityBanner`) and interactive
 * actions (pull-to-refresh) can refuse with a message instead of spinning
 * forever on a paused fetch.
 *
 * `isNetworkOffline(state)` is the single place that decides what "offline"
 * means: not connected, or connected to a network that is known to have no
 * internet reachability (captive portal, VPN without route). `null`
 * reachability (NetInfo still probing) counts as online so the banner never
 * flashes during a cold start.
 */
import { create } from "zustand";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

export interface NetworkStatus {
  /** `true` until NetInfo reports otherwise — never flash offline on boot. */
  online: boolean;
}

export function isNetworkOffline(
  state: Pick<NetInfoState, "isConnected" | "isInternetReachable">,
): boolean {
  if (state.isConnected === false) return true;
  return state.isInternetReachable === false;
}

export const useNetworkStore = create<NetworkStatus>(() => ({ online: true }));

let unsubscribe: (() => void) | null = null;

/** Idempotent — the root layout calls it once per process. */
export function startNetworkMonitor(): () => void {
  if (unsubscribe) return unsubscribe;
  unsubscribe = NetInfo.addEventListener((state) => {
    const online = !isNetworkOffline(state);
    if (useNetworkStore.getState().online !== online) {
      useNetworkStore.setState({ online });
    }
  });
  return unsubscribe;
}

/** Synchronous read for non-React callers (refresh guards, mutations). */
export function isOnline(): boolean {
  return useNetworkStore.getState().online;
}

export function useIsOnline(): boolean {
  return useNetworkStore((s) => s.online);
}

/** No-answer error: `viewCreateErrorKind` & co. read a `TypeError` as offline. */
export function offlineError(): TypeError {
  return new TypeError("Network request failed: offline");
}

/**
 * Runs a write that must not wait for the network: offline it is
 * not started at all, and going offline while it runs rejects at once with
 * `offlineError()`, so the caller's "Speichern …" does not stay stuck on a
 * request the dropped link may never answer. A request that still reaches
 * the server later only bumps the revision; the next save then gets the 409.
 */
export function runWhileOnline<T>(run: () => Promise<T>): Promise<T> {
  if (!isOnline()) return Promise.reject(offlineError());
  let unsubscribe = () => {};
  const offline = new Promise<never>((_, reject) => {
    unsubscribe = useNetworkStore.subscribe((s) => {
      if (!s.online) reject(offlineError());
    });
  });
  const work = run();
  work.catch(() => undefined); // the loser of the race must not go unhandled
  return Promise.race([work, offline]).finally(unsubscribe);
}
