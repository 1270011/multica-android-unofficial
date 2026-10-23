/**
 * Live refresh helpers — pure functions over `QueryClient`.
 *
 * WS events keep the caches fresh while a socket is authenticated. Three gaps
 * remain, and this module closes them without polling:
 *
 *   1. Focus refresh. `refetchOnWindowFocus` only fires on AppState (app to
 *      foreground), never on a tab switch or a back navigation. A screen that
 *      regains focus calls `refreshOnFocus` for its keys; it refetches only
 *      what may have drifted (see `needsFocusRefresh`), so a healthy socket
 *      costs no request.
 *   2. Off-screen records. Per-record hooks (`useIssueRealtime`,
 *      `useChatSessionRealtime`) only run while their screen is mounted. An
 *      event for a closed issue or chat session marks its cache stale
 *      (`refetchType: "none"`: no request now, a refetch on the next mount).
 *   3. Reconnect. After a socket gap every cached record may have
 *      missed events, but refetching everything mounted is expensive: stack
 *      screens stay mounted, so each issue in the back stack refetched ~6
 *      queries on every return from the background.
 *      `invalidateAfterReconnect` (reconnect-refresh.ts) marks the caches
 *      stale and refetches at once only queries that no unfocused screen
 *      parked (`parkFocusKeys`, set by `useRefreshOnFocus`). A parked screen
 *      refetches once when it regains focus.
 *   4. Membership. `issue:updated` patches cached rows in place, which cannot
 *      add an issue that was just assigned to me or drop one that was taken
 *      away from me. `myIssuesMembershipChanged` decides when the server-
 *      filtered "My Issues" lists must refetch.
 */
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { chatKeys } from "@/data/queries/chat";
import { issueKeys } from "@/data/queries/issue-keys";

/** Upper bound for data age on focus even with a healthy socket: events the
 *  realtime layer does not handle (or a server that drops one) must not leave
 *  a screen stale for the whole session. Not a timer — only checked on focus. */
export const FOCUS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Does this query need a refetch when its screen regains focus?
 *   - it was invalidated (an event or a reconnect marked it stale),
 *   - there is no authenticated socket right now (events are not arriving),
 *   - its data predates the current socket (events from the gap before the
 *     socket came up may be missing), or
 *   - it is older than FOCUS_MAX_AGE_MS.
 */
export function needsFocusRefresh(
  query: Pick<Query, "state">,
  connectedSince: number | null,
  now: number,
  maxAgeMs = FOCUS_MAX_AGE_MS,
): boolean {
  const { dataUpdatedAt, isInvalidated } = query.state;
  if (dataUpdatedAt === 0) return false; // never loaded — mount handles it
  if (isInvalidated) return true;
  if (connectedSince === null) return true;
  if (dataUpdatedAt < connectedSince) return true;
  return now - dataUpdatedAt > maxAgeMs;
}

/** Refetch the active queries under `queryKeys` that `needsFocusRefresh`
 *  selects. Returns the number of queries refetched (for tests/logging). */
export function refreshOnFocus(
  qc: QueryClient,
  queryKeys: readonly QueryKey[],
  connectedSince: number | null,
  now = Date.now(),
): number {
  let count = 0;
  for (const queryKey of queryKeys) {
    const due = qc
      .getQueryCache()
      .findAll({ queryKey, type: "active" })
      .filter((q) => needsFocusRefresh(q, connectedSince, now));
    for (const q of due) {
      count += 1;
      // Join a running fetch (two hooks may cover the same key, e.g. the
      // issue screen and its embedded chat) instead of restarting it.
      void qc.refetchQueries(
        { queryKey: q.queryKey, exact: true },
        { cancelRefetch: false },
      );
    }
  }
  return count;
}

/** Mark a closed issue's timeline stale so reopening it refetches. The open
 *  issue is patched in place by `useIssueRealtime`; marking it stale too is
 *  harmless (no request is made). */
export function markIssueTimelineStale(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  void qc.invalidateQueries({
    queryKey: issueKeys.timeline(wsId, issueId),
    refetchType: "none",
  });
}

/** Mark a chat session's messages stale (staleTime is Infinity there, so
 *  without this a closed session would show old messages on reopen). */
export function markChatMessagesStale(qc: QueryClient, sessionId: string) {
  void qc.invalidateQueries({
    queryKey: chatKeys.messages(sessionId),
    refetchType: "none",
  });
  void qc.invalidateQueries({
    queryKey: chatKeys.pendingTask(sessionId),
    refetchType: "none",
  });
}

/**
 * Did this `issue:updated` possibly move the issue into or out of a
 * server-filtered "My Issues" list? The scopes filter by assignee (assigned,
 * agents) and creator (never changes), so only an assignee change matters.
 * The server flag is authoritative. Publishers without it (the task service's
 * status flips during an agent run, delete snapshots) fall back to a diff
 * against the cached rows. An issue in no cached list counts as unchanged:
 * agent runs flip statuses often, and refetching every paged list on each of
 * them would cost more than the rare missed assignment, which the focus
 * refresh's max age still catches.
 */
export function myIssuesMembershipChanged(
  qc: QueryClient,
  wsId: string,
  issue: Partial<Issue> & { id: string },
  assigneeChanged: boolean | undefined,
): boolean {
  if (assigneeChanged !== undefined) return assigneeChanged;
  for (const [, data] of qc.getQueriesData<Issue[]>({
    queryKey: issueKeys.myAll(wsId),
  })) {
    const cached = data?.find((i) => i.id === issue.id);
    if (!cached) continue;
    if (
      (issue.assignee_id !== undefined &&
        issue.assignee_id !== cached.assignee_id) ||
      (issue.assignee_type !== undefined &&
        issue.assignee_type !== cached.assignee_type)
    ) {
      return true;
    }
  }
  return false;
}
