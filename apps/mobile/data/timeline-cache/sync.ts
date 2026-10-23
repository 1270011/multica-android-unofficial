/**
 * When must an opened issue sync its timeline with the server? (rule C11)
 *
 * The sync on open may be skipped ONLY when the WS of this process has been
 * connected without a break since the timeline was last fetched from the
 * server. Then every change since has arrived as a WS patch. In every other
 * case it syncs:
 *   - cold start: the data came from the device (`dataUpdatedAt` 0, nothing
 *     fetched in this process),
 *   - WS rebuilt since the fetch (`connectedSince` is later) or no socket,
 *   - the fetch is older than SYNC_MAX_AGE_MS,
 *   - an event marked the query stale (`isInvalidated`).
 *
 * The fetch time is tracked here, not read from `dataUpdatedAt`: WS patches
 * (`setQueryData`) move `dataUpdatedAt` forward without a server answer.
 * It is the time the fetch STARTED: the server state
 * is at least that old, and a fetch that spans a reconnect must not count
 * as newer than the new socket, or events from the gap stay missing.
 * Pure module (no native imports) so vitest covers it.
 */
import type { Query } from "@tanstack/react-query";
import { entryKey } from "./core";

export const SYNC_MAX_AGE_MS = 10 * 60 * 1000;

/** entryKey → epoch ms of the last server answer in this process (when
 *  its fetch started). */
const syncedAt = new Map<string, number>();
/** entryKey → start of the fetch that is running now (queryFn). */
const fetchStartedAt = new Map<string, number>();

/** The timeline queryFn starts a server fetch. A retry overwrites it: the
 *  answer then belongs to the later attempt. */
export function noteTimelineFetchStarted(wsId: string, issueId: string, at: number): void {
  fetchStartedAt.set(entryKey(wsId, issueId), at);
}

/** The running fetch ended without an answer (error). */
export function dropTimelineFetchStart(wsId: string, issueId: string): void {
  fetchStartedAt.delete(entryKey(wsId, issueId));
}

/** A server answer for this timeline arrived (not a WS patch). `answeredAt`
 *  is only used when no fetch start was noted (fetch outside the queryFn). */
export function noteTimelineSynced(wsId: string, issueId: string, answeredAt: number): void {
  const key = entryKey(wsId, issueId);
  const at = fetchStartedAt.get(key) ?? answeredAt;
  fetchStartedAt.delete(key);
  if (at > 0) syncedAt.set(key, at);
}

/** Last server answer in this process, or undefined. */
export function lastTimelineSync(wsId: string, issueId: string): number | undefined {
  return syncedAt.get(entryKey(wsId, issueId));
}

/** The next open must sync (entry removed, access lost). */
export function forgetTimelineSync(wsId: string, issueId: string): void {
  syncedAt.delete(entryKey(wsId, issueId));
}

export function forgetWorkspaceSync(wsId: string): void {
  const prefix = entryKey(wsId, "");
  for (const map of [syncedAt, fetchStartedAt]) {
    for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k);
  }
}

/** Session end and tests. */
export function clearTimelineSync(): void {
  syncedAt.clear();
  fetchStartedAt.clear();
}

export function timelineNeedsSync(
  state: Pick<Query["state"], "data" | "dataUpdatedAt" | "isInvalidated">,
  wsId: string | null,
  issueId: string,
  connectedSince: number | null,
  now: number,
): boolean {
  if (!wsId || state.data === undefined) return true;
  if (state.isInvalidated || state.dataUpdatedAt === 0) return true;
  const synced = lastTimelineSync(wsId, issueId);
  if (synced === undefined) return true;
  if (connectedSince === null || connectedSince > synced) return true;
  return now - synced > SYNC_MAX_AGE_MS;
}

/**
 * Resolves after the next frame was drawn, so a sync started on open does
 * not hold up the first render of the cached chat. Without
 * `requestAnimationFrame` (tests) it is one macrotask.
 */
export function afterFirstFrame(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown })
      .requestAnimationFrame;
    if (typeof raf === "function") raf(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}
