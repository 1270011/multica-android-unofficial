/**
 * Workspace Issues realtime — listing-level subscription. Mounted globally
 * (workspace-session-lifetime) alongside `useMyIssuesRealtime` so the
 * workspace-wide list stays fresh regardless of which tab is foregrounded.
 *
 * issue:created     — payload includes the full Issue object; prepend in
 *                     place. Avoids a refetch and keeps UI snappy when
 *                     someone else creates an issue while we're looking
 *                     at the list.
 * issue:updated     — patch in-place; client-side filter/grouping
 *                     re-derives on the next render.
 * issue:deleted     — strip from the list.
 * issue_labels:changed — handled by `patchIssueLabels` in the shared
 *                     updaters (already patches `list(wsId)` too — see
 *                     `issue-ws-updaters.ts`). No subscription needed
 *                     here because `useMyIssuesRealtime` already drives
 *                     it for every workspace surface.
 * issue:updated     — also patches a cached (closed) issue detail, so
 *                     reopening it does not show the old status first.
 * comment:* / activity:created / reaction:* — mark the issue's timeline
 *                     stale (no request). Edits and deletes also patch the
 *                     in-memory and the on-device timeline. The open issue is patched by
 *                     `useIssueRealtime`; a closed one refetches on the
 *                     next mount instead of showing a cached old thread
 *.
 * onReconnect       — mark the whole `issues/<wsId>` prefix stale: events
 *                     for any list, detail or timeline may have been missed
 *                     while disconnected (background, network change).
 *                     Only active queries of focused screens refetch now;
 *                     screens in the back stack refetch when they regain
 *                     focus, the rest on their next mount
 *                     (`invalidateAfterReconnect`). Web refetches all
 *                     mounted queries, but web has no stack of mounted
 *                     screens.
 *
 * This hook is independent of `useMyIssuesRealtime` (different cache key
 * `list(wsId)` vs `myAll(wsId)`). Both are listing-level and run in
 * parallel — apps/mobile/CLAUDE.md "Mobile-owned updaters" / "list-level
 * global, per-record per-screen".
 */
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys } from "@/data/queries/issue-keys";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import type { Comment, TimelineEntry } from "@multica/core/types";
import {
  patchCachedTimeline,
  removeCachedTimeline,
} from "@/data/timeline-cache";
import { markIssueTimelineStale } from "./live-refresh";
import { invalidateAfterReconnect } from "./reconnect-refresh";
import {
  commentToTimelineEntry,
  withCommentReplaced,
  withoutCommentCascade,
  patchIssueDetail,
  patchIssuesList,
  prependToIssuesList,
  removeFromIssuesList,
} from "./issue-ws-updaters";

export function useIssuesRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const invalidateAllIssues = () =>
        invalidateAfterReconnect(qc, issueKeys.all(wsId));
      const markTimeline = (issueId: string | undefined) => {
        if (issueId) markIssueTimelineStale(qc, wsId, issueId);
      };
      // Edits and deletes also change the copy on the
      // device, for every issue, open or not. A deleted comment (maybe with
      // a pasted secret) must not stay there until the issue is reopened.
      // The in-memory timeline is patched too (same no-op as the open
      // issue's handler when that one ran first): a just-closed issue may
      // still have a throttled write pending, and that write stores the
      // in-memory data.
      const patchTimeline = (
        issueId: string,
        patch: (entries: TimelineEntry[]) => TimelineEntry[],
      ) => {
        qc.setQueryData<TimelineEntry[]>(
          issueKeys.timeline(wsId, issueId),
          (old) => (old ? patch(old) : old),
        );
        patchCachedTimeline(wsId, issueId, patch);
      };
      const onCommentChanged = (comment: Comment | undefined) => {
        if (!comment?.issue_id) return;
        markTimeline(comment.issue_id);
        const entry = commentToTimelineEntry(comment);
        patchTimeline(comment.issue_id, (entries) =>
          withCommentReplaced(entries, entry),
        );
      };

      return [
        ws.on("issue:created", (payload) => {
          prependToIssuesList(qc, wsId, payload.issue);
        }),
        ws.on("issue:updated", (payload) => {
          patchIssuesList(qc, wsId, payload.issue);
          patchIssueDetail(qc, wsId, payload.issue);
        }),
        ws.on("issue:deleted", (payload) => {
          removeFromIssuesList(qc, wsId, payload.issue_id);
          removeCachedTimeline(wsId, payload.issue_id);
        }),
        ws.on("comment:created", (p) => markTimeline(p.comment?.issue_id)),
        ws.on("comment:updated", (p) => onCommentChanged(p.comment)),
        ws.on("comment:resolved", (p) => onCommentChanged(p.comment)),
        ws.on("comment:unresolved", (p) => onCommentChanged(p.comment)),
        ws.on("comment:deleted", (p) => {
          markTimeline(p.issue_id);
          if (!p.issue_id) return;
          patchTimeline(p.issue_id, (entries) =>
            withoutCommentCascade(entries, p.comment_id),
          );
        }),
        ws.on("activity:created", (p) => markTimeline(p.issue_id)),
        ws.on("reaction:added", (p) => markTimeline(p.issue_id)),
        ws.on("reaction:removed", (p) => markTimeline(p.issue_id)),
        ws.onReconnect(invalidateAllIssues),
      ];
    },
    [qc],
  );
}
