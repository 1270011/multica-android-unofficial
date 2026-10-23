/**
 * Per-issue realtime subscriptions. Mounted by the issue detail screen
 * with the active issue id; cleans up on navigate-away.
 *
 * Handles:
 *   - issue:updated / issue:deleted / issue_labels:changed → detail cache
 *   - issue_attachments:changed → attachment cache
 *   - comment:created / comment:updated / comment:deleted → timeline +
 *     owner issue revision (detail / list projections)
 *   - activity:created → timeline
 *   - reaction:added / reaction:removed → comment reactions on timeline
 *   - issue_reaction:added / issue_reaction:removed → issue-level reactions on detail
 *   - task:queued / task:dispatch → task queries (live "agent working" row)
 *   - task:progress → task queries, bundled to one refetch per second
 *   - task:completed / task:failed / task:cancelled → task queries now, plus
 *     timeline + detail bundled to one refetch per second (task state can
 *     flip an issue's status server-side without firing issue:updated, so we
 *     refetch the authoritative detail too). Non-terminal events never touch
 *     the timeline: on a big issue each refetch cost ~430 ms JS.
 *   - reconnect → invalidate detail + timeline (we might've missed events
 *     while disconnected; server has no replay buffer for this client)
 *
 * Mobile pattern (per the realtime plan, see
 * /Users/qingnaiyuan/.claude/plans/plan-api-indexed-waffle.md):
 *   - Patch over invalidate where the payload contains the full object
 *   - Versioned events win only when their owner revision is not older than
 *     cached state; an unversioned event over versioned state triggers refetch.
 *   - All handlers self-gate on `issue_id === issueId` so we only react
 *     to events for the currently-viewed issue.
 */
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  TaskCancelledPayload,
  TaskCompletedPayload,
  TaskDispatchPayload,
  TaskFailedPayload,
  TaskMessagePayload,
  TaskQueuedPayload,
} from "@multica/core/types";
import { issueKeys } from "@/data/queries/issue-keys";
import { wakeupKeys } from "@/data/queries/wakeup-keys";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { coalesce } from "./coalesce";
import {
  addCommentReaction,
  addIssueReaction,
  onIssueAuxiliaryRevision,
  appendTimelineEntry,
  clearIssueDetail,
  commentToTimelineEntry,
  invalidateIssueAfterReconnect,
  invalidateIssueOwnerProjections,
  patchIssueDetail,
  patchIssueLabels,
  patchIssuesList,
  patchMyIssuesList,
  replaceCommentTimelineEntry,
  removeCommentCascade,
  removeCommentReaction,
  removeFromMyIssuesList,
  removeIssueReaction,
} from "./issue-ws-updaters";
import { invalidateAfterReconnect } from "./reconnect-refresh";

type TaskEventPayload =
  | TaskQueuedPayload
  | TaskDispatchPayload
  | TaskCompletedPayload
  | TaskFailedPayload
  | TaskCancelledPayload
  | TaskMessagePayload;

/** Throttle for wakeup refetches driven by task/issue events. */
export const WAKEUP_REFRESH_MS = 5000;

export function useIssueRealtime(
  issueId: string | undefined,
  onDeleted?: () => void,
) {
  const qc = useQueryClient();
  // Callers pass `onDeleted` inline (`() => router.back()`), so its identity
  // changes on every render. Kept out of the deps: as a dep it re-subscribed
  // on every render, and each cleanup cancelled the pending bundled refetch
  // after task:completed, so the timeline never reloaded.
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  useWSSubscriptions(
    (ws, wsId) => {
      if (!issueId) return;

      const invalidateThisIssue = () => {
        qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
        qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
      };

      // Task-query invalidation — separate from detail/timeline so the
      // AgentActivityRow + RunsSheet can refresh without forcing a full
      // timeline rebuild. WS task payloads only carry { task_id, agent_id,
      // issue_id, status } — not the full AgentTask object — so per
      // apps/mobile/CLAUDE.md "Patch over invalidate" rule #1 (payload is
      // just an id), invalidate is the correct primitive.
      const invalidateTaskQueries = () => {
        qc.invalidateQueries({ queryKey: issueKeys.activeTasks(wsId, issueId) });
        qc.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) });
      };

      // Comments and activity of a run arrive through their own events and
      // are patched in place; the terminal event only needs one
      // authoritative refetch. A burst of them (several runs ending, or
      // retries) shares that refetch.
      const thisIssueRefresh = coalesce(invalidateThisIssue);
      const taskQueriesRefresh = coalesce(invalidateTaskQueries);

      // Wakeups have no WS events of their own: task and issue
      // events refresh the whole `wakeupKeys.all` prefix (issue section,
      // header chip, overview), at most every 5 s. An event inside the
      // window schedules ONE trailing refresh, so the last event of a burst
      // (task:completed right after task:queued) is not lost.
      let lastWakeupRefresh = 0;
      let wakeupTimer: ReturnType<typeof setTimeout> | null = null;
      const refreshWakeups = (afterReconnect = false) => {
        if (wakeupTimer) clearTimeout(wakeupTimer);
        wakeupTimer = null;
        lastWakeupRefresh = Date.now();
        // After a reconnect this issue's own rules stay deferred while its
        // screen is parked in the back stack.
        if (afterReconnect) invalidateAfterReconnect(qc, wakeupKeys.all(wsId));
        else qc.invalidateQueries({ queryKey: wakeupKeys.all(wsId) });
      };
      const invalidateWakeups = () => {
        const wait = lastWakeupRefresh + WAKEUP_REFRESH_MS - Date.now();
        if (wait <= 0) refreshWakeups();
        else wakeupTimer ??= setTimeout(() => refreshWakeups(), wait);
      };

      // queued / dispatch / completed / failed / cancelled carry `issue_id`
      // (server taskEvent: task_id, agent_id, issue_id, status). `task:progress`
      // does not (TaskProgressPayload: task_id, summary, step, total), so it
      // never matches here. If a new task event lands without
      // `issue_id`, this cast is the failure point — grep here.
      const isThisIssue = (p: unknown) =>
        (p as TaskEventPayload).issue_id === issueId;

      // queued / dispatch change the live status — refresh it right away.
      const onTaskStateEvent = (p: unknown) => {
        if (!isThisIssue(p)) return;
        invalidateTaskQueries();
        invalidateWakeups();
      };
      // progress streams while the agent works; status stays "running".
      const onTaskProgress = (p: unknown) => {
        if (!isThisIssue(p)) return;
        taskQueriesRefresh.schedule();
      };
      const onTaskFinished = (p: unknown) => {
        if (!isThisIssue(p)) return;
        invalidateTaskQueries();
        thisIssueRefresh.schedule();
        invalidateWakeups();
      };

      return [
        // ----- Issue-level -----
        ws.on("issue:updated", (payload) => {
          if (payload.issue.id !== issueId) return;
          patchIssueDetail(qc, wsId, payload.issue);
          patchMyIssuesList(qc, wsId, payload.issue);
          patchIssuesList(qc, wsId, payload.issue);
          // A status change can satisfy or end a rule server-side.
          invalidateWakeups();
        }),
        ws.on("issue:deleted", (payload) => {
          if (payload.issue_id !== issueId) return;
          clearIssueDetail(qc, wsId, issueId);
          removeFromMyIssuesList(qc, wsId, issueId);
          onDeletedRef.current?.();
        }),
        ws.on("issue_labels:changed", (payload) => {
          if (payload.issue_id !== issueId) return;
          patchIssueLabels(qc, wsId, issueId, payload.labels, payload.issue_revision);
        }),
        ws.on("issue_attachments:changed", (payload) => {
          if (payload.issue_id !== issueId) return;
          onIssueAuxiliaryRevision(qc, wsId, issueId, payload.issue_revision);
          qc.invalidateQueries({
            queryKey: issueKeys.attachments(wsId, issueId),
          });
        }),

        // ----- Comments / activity -----
        ws.on("comment:created", (payload) => {
          if (payload.comment.issue_id !== issueId) return;
          appendTimelineEntry(
            qc,
            wsId,
            issueId,
            commentToTimelineEntry(payload.comment),
          );
          onIssueAuxiliaryRevision(qc, wsId, issueId, payload.issue_revision);
        }),
        ws.on("comment:updated", (payload) => {
          if (payload.comment.issue_id !== issueId) return;
          const entry = commentToTimelineEntry(payload.comment);
          replaceCommentTimelineEntry(qc, wsId, issueId, entry);
          // Edits and tombstoning deletes can advance the owner issue
          // (revision, last_activity_at). Mirrors web's comment handlers: apply
          // issue_revision when present, otherwise refetch the owner projections.
          if (payload.issue_revision) {
            onIssueAuxiliaryRevision(qc, wsId, issueId, payload.issue_revision);
          } else {
            invalidateIssueOwnerProjections(qc, wsId, issueId);
          }
        }),
        // Resolve / unresolve broadcast from any client. Payload carries the
        // full Comment with the new resolved_at/resolved_by_* fields, so we
        // can in-place-replace the entry via commentToTimelineEntry — no
        // refetch. Without these handlers the resolved state only updated
        // via the local mutation or via reconnect invalidate (the second
        // costs a full timeline refetch and busts every CommentCard memo).
        ws.on("comment:resolved", (payload) => {
          if (payload.comment.issue_id !== issueId) return;
          const entry = commentToTimelineEntry(payload.comment);
          replaceCommentTimelineEntry(qc, wsId, issueId, entry);
        }),
        ws.on("comment:unresolved", (payload) => {
          if (payload.comment.issue_id !== issueId) return;
          const entry = commentToTimelineEntry(payload.comment);
          replaceCommentTimelineEntry(qc, wsId, issueId, entry);
        }),
        ws.on("comment:deleted", (payload) => {
          if (payload.issue_id !== issueId) return;
          // A comment with replies is tombstoned (comment:updated), never
          // removed, so any cached reply of a removed comment is stale (older
          // servers cascaded the delete). Sweep them so buildTimelineRows
          // does not promote them to ghost top-level rows.
          removeCommentCascade(qc, wsId, issueId, payload.comment_id);
          if (payload.issue_revision) {
            onIssueAuxiliaryRevision(qc, wsId, issueId, payload.issue_revision);
          } else {
            invalidateIssueOwnerProjections(qc, wsId, issueId);
          }
        }),
        ws.on("activity:created", (payload) => {
          if (payload.issue_id !== issueId) return;
          appendTimelineEntry(qc, wsId, issueId, payload.entry);
        }),

        // ----- Comment reactions -----
        ws.on("reaction:added", (payload) => {
          if (payload.issue_id !== issueId) return;
          addCommentReaction(
            qc,
            wsId,
            issueId,
            payload.reaction.comment_id,
            payload.reaction,
            payload.comment_revision,
          );
        }),
        ws.on("reaction:removed", (payload) => {
          if (payload.issue_id !== issueId) return;
          removeCommentReaction(
            qc,
            wsId,
            issueId,
            payload.comment_id,
            payload.emoji,
            payload.actor_id,
            payload.comment_revision,
          );
        }),

        // ----- Issue-level reactions -----
        ws.on("issue_reaction:added", (payload) => {
          if (payload.issue_id !== issueId) return;
          addIssueReaction(qc, wsId, issueId, payload.reaction, payload.issue_revision);
        }),
        ws.on("issue_reaction:removed", (payload) => {
          if (payload.issue_id !== issueId) return;
          removeIssueReaction(
            qc,
            wsId,
            issueId,
            payload.emoji,
            payload.actor_id,
            payload.issue_revision,
          );
        }),

        // ----- Agent task progress -----
        ws.on("task:queued", onTaskStateEvent),
        ws.on("task:dispatch", onTaskStateEvent),
        ws.on("task:progress", onTaskProgress),
        ws.on("task:completed", onTaskFinished),
        ws.on("task:failed", onTaskFinished),
        ws.on("task:cancelled", onTaskFinished),
        thisIssueRefresh.cancel,
        taskQueriesRefresh.cancel,

        // ----- Reconnect -----
        ws.onReconnect(() => {
          invalidateIssueAfterReconnect(qc, wsId, issueId);
          refreshWakeups(true);
        }),
        () => {
          if (wakeupTimer) clearTimeout(wakeupTimer);
        },
      ];
    },
    [issueId, qc],
  );
}
