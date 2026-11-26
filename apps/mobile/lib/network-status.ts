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
 *
 * NetInfo alone, however, can lag reality: Android only decides
 * `isInternetReachable` after its own reachability probe — which can trail
 * a reconnect by many seconds — and on a Local / VPN setup it can stay
 * `false` forever while the Multica server is reachable just fine. So the
 * store also follows what the network actually does (see
 * `markNetworkOnline` / `markNetworkOffline`): any response from the
 * server proves the link, a connection-level fetch failure breaks it, and
 * while the store says offline a small probe re-checks the configured
 * server every few seconds, clearing the offline state the moment it
 * answers.
 */
import { create } from "zustand";
import { onlineManager } from "@tanstack/react-query";
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

// ── Observed reachability ────────────────────────────────────────────────
// See the module doc: NetInfo can lag or disagree with reality, so actual
// traffic gets a say. Upward flips (a response arrived) also resume
// TanStack Query; downward flips only move the banner, so one bad request
// can never wedge the app in a paused state — the probe or the next
// successful request corrects it.

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;

let probeUrl: string | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeInFlight = false;

/** Called by the API layer once it knows the server base URL. Idempotent;
 *  `null` (no server configured yet) falls back to NetInfo-only semantics. */
export function setNetworkProbeUrl(url: string | null): void {
  if (probeUrl === url) return;
  probeUrl = url;
  maybeProbe();
}

function stopProbe(): void {
  if (probeTimer !== null) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function maybeProbe(): void {
  if (!probeUrl || probeInFlight || useNetworkStore.getState().online) return;
  probeInFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // The target is the bare server base URL: any response — 200, 401, the
  // web app's HTML — proves the link is up. The cache-buster keeps the
  // platform HTTP cache from answering for the network.
  const target = `${probeUrl}${probeUrl.includes("?") ? "&" : "?"}_probe=${Date.now()}`;
  void fetch(target, { signal: controller.signal })
    .then(
      () => {
        markNetworkOnline();
      },
      () => {
        // Unreachable — stay offline; the retry below keeps checking.
      },
    )
    .finally(() => {
      clearTimeout(timeout);
      probeInFlight = false;
      if (!useNetworkStore.getState().online) {
        stopProbe();
        probeTimer = setTimeout(() => {
          probeTimer = null;
          maybeProbe();
        }, PROBE_INTERVAL_MS);
      }
    });
}

/** Proven reachability: a response (or a successful probe) flips the app
 *  online even while NetInfo still reports offline. Also resumes TanStack
 *  Query, whose pause signal follows NetInfo and may not have flipped yet. */
export function markNetworkOnline(): void {
  stopProbe();
  if (useNetworkStore.getState().online) return;
  useNetworkStore.setState({ online: true });
  onlineManager.setOnline(true);
}

/** A connection-level fetch failure marks the app offline at once, without
 *  waiting for NetInfo. TanStack Query's pause signal is NOT touched: only
 *  proven reachability (probe or successful request) may resume it. */
export function markNetworkOffline(): void {
  if (useNetworkStore.getState().online) {
    useNetworkStore.setState({ online: false });
  }
  maybeProbe();
}

let unsubscribe: (() => void) | null = null;

/** Idempotent — the root layout calls it once per process. */
export function startNetworkMonitor(): () => void {
  if (unsubscribe) return unsubscribe;
  unsubscribe = NetInfo.addEventListener((state) => {
    if (isNetworkOffline(state)) {
      markNetworkOffline();
    } else {
      markNetworkOnline();
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
