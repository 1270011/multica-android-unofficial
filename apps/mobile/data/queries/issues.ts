/**
 * Issue queries — workspace-wide list, single-issue detail, timeline.
 * Mobile-owned; mirrors a strict subset of packages/core/issues/queries.ts.
 *
 * Query keys live in ./issue-keys so detail / timeline / list / myList all
 * sit under the `issues/<wsId>` prefix — WS handlers can invalidate the
 * whole subtree with one call when needed.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { issueKeys } from "./issue-keys";
import { listIssuePages } from "./list-pages";
import { rememberListTotal } from "./list-total";
import { isAccessLost, readCachedTimelineInChunks } from "@/data/timeline-cache";
import {
  afterFirstFrame,
  noteTimelineFetchStarted,
  timelineNeedsSync,
} from "@/data/timeline-cache/sync";
import { socketConnectedSince } from "@/data/realtime/socket-liveness";

export { issueKeys } from "./issue-keys";

/**
 * Workspace-wide issue list. Backend filters by `X-Workspace-Slug` header
 * (root CLAUDE.md "All queries filter by workspace_id"), so we pass an
 * empty params object — server returns every issue the user is allowed to
 * see in the current workspace.
 *
 * Cache shape: flat `Issue[]` (we strip `.issues` from the response) so
 * the WS updaters can patch this list with the same shape as
 * myIssueListOptions. The server sends 100 issues per request, so the
 * list loads page by page up to 1000 issues (list-pages.ts).
 */
export const issueListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: issueKeys.list(wsId),
    queryFn: async ({ signal, client, queryKey }) => {
      const res = await listIssuePages({}, { signal });
      rememberListTotal(client, queryKey, res.total);
      return res.issues;
    },
    enabled: !!wsId,
  });

export const issueDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Single query over the full issue timeline (ASC, oldest first). Mirrors
 * web's `issueTimelineOptions` post-#2322 — server returns the whole list
 * in one shot, client-side pagination was deleted.
 *
 * The last known timeline comes from the on-device cache when
 * the issue is opened, read only then. The queryFn reads it with the
 * schema check split into short blocks (no long JS block while
 * the chat opens) and shows it at once; it counts as stale (`updatedAt` 0),
 * so the server sync runs and its answer replaces it; the persister writes
 * nothing back until that answer came.
 *
 * The sync on open is skipped only while the socket has
 * stayed up since the last server answer of this process
 * (`timelineNeedsSync`, measured from the start of that fetch); then WS
 * patches kept it current and reopening a big issue costs no request. When it syncs over shown data, it starts
 * after the next frame so the cached chat renders first. 403/404 are not
 * retried: the persister drops the entry and the data.
 */
export const issueTimelineOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.timeline(wsId, id),
    queryFn: async ({ signal, client, queryKey }) => {
      // The answer counts from here, not from its arrival.
      if (wsId) noteTimelineFetchStarted(wsId, id, Date.now());
      if (client.getQueryData(queryKey) === undefined) {
        // C12 in short blocks, not in the render. Stale
        // (`updatedAt` 0) and not written back by the persister.
        const cached = await readCachedTimelineInChunks(wsId, id, signal);
        if (cached && !signal.aborted && client.getQueryData(queryKey) === undefined) {
          client.setQueryData(queryKey, cached.entries, { updatedAt: 0 });
        }
      }
      if (client.getQueryData(queryKey) !== undefined) await afterFirstFrame();
      return api.listTimeline(id, { signal });
    },
    enabled: !!wsId && !!id,
    staleTime: (query) =>
      timelineNeedsSync(query.state, wsId, id, socketConnectedSince(), Date.now())
        ? 0
        : Infinity,
    retry: (failureCount, error) => !isAccessLost(error) && failureCount < 1,
  });

/**
 * Currently-running tasks for an issue. WS events (task:queued/dispatch/
 * progress/completed/failed/cancelled) patch this cache directly via
 * `issue-ws-updaters.ts`, so refetches are rare in practice. The fetch is
 * still wired so the initial open + reconnect-invalidate path works.
 */
export const issueActiveTasksOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.activeTasks(wsId, id),
    queryFn: ({ signal }) => api.listActiveTasksForIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * All tasks (any status) for an issue — drives the Runs sheet history
 * section. Same patching strategy as active tasks: WS moves entries between
 * the two caches without refetching.
 */
export const issueTasksOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.tasks(wsId, id),
    queryFn: ({ signal }) => api.listTasksByIssue(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * File attachments uploaded to this issue or any of its comments. The
 * mobile markdown renderer reads this list to resolve `mc://file/<id>`
 * URIs in image markdown to a real HTTPS `download_url` that iOS can
 * actually load — see `lib/markdown/markdown-image.tsx`.
 *
 * TanStack Query dedupes the request across concurrent callers, so it's
 * safe for both IssueDescription and CommentCard to fetch the same
 * issue's attachments — only one network request fires.
 */
export const issueAttachmentsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.attachments(wsId, id),
    queryFn: ({ signal }) => api.listAttachments(id, { signal }),
    enabled: !!wsId && !!id,
  });

/** Sub-issues for the detail "Sub-issues" section (web: SubIssueRow list). */
export const issueChildrenOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.children(wsId, id),
    queryFn: ({ signal }) => api.listChildIssues(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const issueDuplicatesOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.duplicates(wsId, id),
    queryFn: ({ signal }) => api.listIssueDuplicates(id, { signal }),
    enabled: !!wsId && !!id,
  });
