/**
 * Keeps locally-authored comments visible across timeline refetches
 * — and exactly once.
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
 *
 * The `comment:created` broadcast of the user's own comment often
 * arrives before the POST answers. It carries the real id, so the id check
 * above did not see that it is the same comment as the optimistic row, and
 * the message stood there twice until the POST settled. A local row is now
 * also dropped once its echo is in the list: a comment by the same author,
 * in the same thread, with the same text, that was not on screen yet when
 * the user pressed send. Each server comment absorbs at most one local row,
 * so the same short text sent twice still shows twice.
 */
import type { TimelineEntry } from "@multica/core/types";

export const OPTIMISTIC_ID_PREFIX = "optimistic-";

/** Device and server clocks differ; an echo may look this much older. */
export const ECHO_CLOCK_SLACK_MS = 2 * 60 * 1000;

let optimisticSeq = 0;

/** Unique even for two sends in the same millisecond. */
export function newOptimisticCommentId(now = Date.now()): string {
  optimisticSeq += 1;
  return `${OPTIMISTIC_ID_PREFIX}${now}-${optimisticSeq}`;
}

export function isOptimisticCommentId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/** A comment of this client that the server has not confirmed yet. */
export interface LocalComment {
  entry: TimelineEntry;
  /** Server comment ids that were already in the timeline when the user
   *  pressed send — none of them can be this comment's echo. */
  knownIds?: ReadonlySet<string>;
}

/** Ids of the server comments in a timeline (snapshot taken at send time). */
export function knownCommentIds(timeline: TimelineEntry[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const entry of timeline ?? []) {
    if (entry.type === "comment" && !isOptimisticCommentId(entry.id)) ids.add(entry.id);
  }
  return ids;
}

/** True when `server` is the comment the local row stands for. */
export function isEchoOf(server: TimelineEntry, local: LocalComment): boolean {
  const own = local.entry;
  if (server.type !== "comment" || isOptimisticCommentId(server.id)) return false;
  if (local.knownIds?.has(server.id)) return false;
  if (server.actor_type !== own.actor_type || server.actor_id !== own.actor_id) return false;
  if ((server.parent_id ?? null) !== (own.parent_id ?? null)) return false;
  if ((server.content ?? "").trim() !== (own.content ?? "").trim()) return false;
  const sent = Date.parse(own.created_at);
  const created = Date.parse(server.created_at);
  if (!Number.isNaN(sent) && !Number.isNaN(created) && created < sent - ECHO_CLOCK_SLACK_MS) {
    return false;
  }
  return true;
}

/** Pending rows (mutation cache) plus failed rows (store) of one issue. */
export function collectLocalComments(
  pending: readonly (LocalComment | null | undefined)[],
  failed: Iterable<{ issueId: string; entry: TimelineEntry; knownIds?: ReadonlySet<string> }>,
  issueId: string,
): LocalComment[] {
  const local: LocalComment[] = [];
  for (const row of pending) if (row) local.push(row);
  for (const row of failed) {
    if (row.issueId === issueId) local.push({ entry: row.entry, knownIds: row.knownIds });
  }
  return local;
}

export function mergeLocalComments(
  server: TimelineEntry[] | undefined,
  local: LocalComment[],
): TimelineEntry[] | undefined {
  // Optimistic rows in the cache are only a copy: the live ones come back
  // through `local` below, the rest (settled, session ended) must not show.
  const base = server?.filter((entry) => !isOptimisticCommentId(entry.id));
  const cleaned = base && base.length !== server!.length;
  if (local.length === 0) return cleaned ? base : server;

  const list = base ?? [];
  const seen = new Set(list.map((entry) => entry.id));
  const claimed = new Set<string>();
  // Oldest first, so the first of two equal sends takes the first echo.
  const ordered = [...local].sort((a, b) => a.entry.created_at.localeCompare(b.entry.created_at));
  const missing: TimelineEntry[] = [];
  for (const row of ordered) {
    if (seen.has(row.entry.id)) continue;
    seen.add(row.entry.id);
    const echo = list.find((entry) => !claimed.has(entry.id) && isEchoOf(entry, row));
    if (echo) {
      claimed.add(echo.id);
      continue;
    }
    missing.push(row.entry);
  }
  if (missing.length === 0) return cleaned ? base : server;
  // ASC timeline: local rows are the newest, but keep their own order stable
  // (creation time) so two queued comments do not swap.
  return [...list, ...missing];
}

/**
 * The cache once a send settled: the optimistic row becomes the server row,
 * or simply goes when the `comment:created` echo already put that row in.
 */
export function settleOptimisticComment(
  timeline: TimelineEntry[] | undefined,
  optimisticId: string,
  server: TimelineEntry,
): TimelineEntry[] | undefined {
  if (!timeline) return timeline;
  const rest = timeline.filter((entry) => entry.id !== optimisticId);
  if (rest.some((entry) => entry.id === server.id && entry.type === server.type)) return rest;
  return [...rest, server].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}
