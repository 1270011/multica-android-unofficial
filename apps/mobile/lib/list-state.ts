/**
 * Which top-level state a list screen shows for its query.
 *
 * Offline, TanStack Query pauses a first fetch: `isPending` stays true,
 * `fetchStatus` is "paused" and `isLoading` is false. Lists that only
 * checked `isLoading` then fell through to their empty state ("No
 * autopilots yet") although nothing was ever loaded. The empty branch is
 * only allowed once data is there.
 */
export type ListState = "loading" | "offline" | "error" | "ready";

export function listState(q: {
  data: unknown;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
}): ListState {
  if (q.data !== undefined) return "ready";
  if (q.error) return "error";
  if (q.fetchStatus === "paused") return "offline";
  return "loading";
}

/**
 * One list fed by several queries (sheet "Ansichten": own + shared
 * views): offline as soon as one first fetch is paused, then error, then
 * loading; ready only when every query has data.
 */
export function combinedListState(qs: readonly Parameters<typeof listState>[0][]): ListState {
  const states = qs.map(listState);
  for (const s of ["offline", "error", "loading"] as const) {
    if (states.includes(s)) return s;
  }
  return "ready";
}
