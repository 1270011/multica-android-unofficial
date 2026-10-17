/**
 * Keeps locally-authored comments visible across timeline refetches.
 *
 * `useCreateComment` appends an optimistic row to the timeline cache. Any
 * refetch — pull-to-refresh, the WebSocket reconnect after an offline
 * period, a focus refetch — replaces that cache with the server list, which
 * does not contain the row while the request is still queued (TanStack
 * pauses mutations offline) or after it failed. The test report saw exactly
 * that: the comment "vanished" with no Failed/Retry affordance.
 *
 * The render path therefore no longer trusts the cache alone: pending rows
 * come from the mutation cache (`useMutationState`) and failed rows from
 * `useFailedCommentsStore`, and this pure merge re-appends whichever are
 * missing. Server rows always win over a local row with the same id.
 */
import type { TimelineEntry } from "@multica/core/types";

export const OPTIMISTIC_ID_PREFIX = "optimistic-";

export function isOptimisticCommentId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

export function mergeLocalComments(
  server: TimelineEntry[] | undefined,
  local: TimelineEntry[],
): TimelineEntry[] | undefined {
  if (local.length === 0) return server;
  const base = server ?? [];
  const seen = new Set(base.map((entry) => entry.id));
  const missing = local.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  if (missing.length === 0) return server;
  // ASC timeline: local rows are the newest, but keep their own order stable
  // (creation time) so two queued comments do not swap.
  missing.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...base, ...missing];
}
