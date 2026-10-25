/**
 * Comment creation mutation. Mirrors the optimistic + invalidate pattern of
 * apps/mobile/data/mutations/inbox.ts:17 — operates on the flat
 * `TimelineEntry[]` timeline cache (ASC, oldest first; server-side
 * pagination was dropped in #2322).
 *
 * Optimistic strategy:
 *   - Cancel timeline refetches.
 *   - Snapshot the current cache.
 *   - Append a synthetic comment-typed TimelineEntry to the end of the list
 *     (newest position, since the array is ASC).
 *   - On error: roll back to the snapshot.
 *   - On success: swap the synthetic row for the server row (or drop it when
 *     the `comment:created` echo is already there), then
 *     invalidate for the authoritative list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AgentTask,
  CreateIssueRequest,
  Issue,
  IssueReaction,
  IssueStatus,
  Label,
  Reaction,
  TimelineEntry,
  UpdateIssueRequest,
} from "@multica/core/types";
import type { AppConfigResponse } from "@multica/core/api/schemas";
import {
  applyCommentDeletion,
  removeCommentSubtree,
} from "@multica/core/issues/comment-deletion";
import { api } from "@/data/api";
import { showToast } from "@/lib/toast";
import { isRevisionConflict } from "@/data/issue-edit";
import { affectedParentIds, issueUpdateErrorKey } from "@/lib/issue-fields";
import { isBuiltInIssueStatus, statusCategoryOfKey } from "@/lib/issue-status";
import { appConfigOptions } from "@/data/queries/billing";
import { issueKeys } from "@/data/queries/issues";
import { inboxKeys } from "@/data/queries/inbox";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { currentSessionEpoch, sessionEpochChanged } from "@/data/session-epoch";
import {
  CommentSessionEndedError,
  commentResendDelay,
  sendCommentAttempt,
  shouldAutoResendComment,
  type CommentSendState,
} from "@/lib/comment-resend";
import {
  commentContentFromTimeline,
  shouldAcceptServerRevision,
} from "@/data/revision";
import {
  advanceCommentRevision,
  invalidateIssueOwnerProjections,
  onIssueAuxiliaryRevision,
  reconcileIssueFullSnapshotRevision,
  commentToTimelineEntry,
  patchIssueLabels,
  replaceCommentTimelineEntry,
} from "@/data/realtime/issue-ws-updaters";
import { rerunErrorKey } from "@/lib/run-transcript";
import {
  knownCommentIds,
  newOptimisticCommentId,
  settleOptimisticComment,
  type LocalComment,
} from "@/lib/pending-comments";
import { noteSentMessage } from "@/lib/use-mention-usage";

export type ToggleCommentReactionVars = {
  commentId: string;
  emoji: string;
  /** Pass the existing Reaction from the entry to indicate this is a remove.
   *  Undefined means "add". Mirrors web's ToggleCommentReactionVars shape so
   *  call sites stay portable across clients. */
  existing?: Reaction;
};

export type ToggleIssueReactionVars = {
  emoji: string;
  /** See above. */
  existing?: IssueReaction;
};

export type CreateCommentVars = {
  content: string;
  /** When set, the new comment is a threaded reply to this comment id. */
  parentId?: string;
  /** Attachment ids previously returned by `useFileAttach.pickAndUpload*`,
   *  filtered by the caller to only those whose `url` is still referenced
   *  in `content`. The server re-parents each attachment from issue-scoped
   *  to comment-scoped so a `DELETE /comment/:id` cascades the attachments
   *  too. Mirrors web's `CommentInput.handleSubmit` `activeIds` derivation
   *  (`packages/views/issues/components/comment-input.tsx:76-78`). */
  attachmentIds?: string[];
  /** Agents deselected in the composer's trigger preview: the server does
   *  not start them for this comment. */
  suppressAgentIds?: string[];
  /** Manual "Retry" of a failed send: an earlier POST from this time on may
   *  have reached the server, so look for it before posting. */
  sentAt?: string;
  /** Manual "Retry": the server comments known at the first send, so an
   *  echo that arrived since is recognised as this comment. */
  knownIds?: ReadonlySet<string>;
};

// Attempt state per submission. TanStack hands the same variables object to
// onMutate and to every retry of mutationFn, so it is the natural key.
const commentSendStates = new WeakMap<CreateCommentVars, CommentSendState>();

function commentSendState(vars: CreateCommentVars): CommentSendState {
  let state = commentSendStates.get(vars);
  if (!state) {
    state = { epoch: currentSessionEpoch(), since: vars.sentAt ?? null };
    commentSendStates.set(vars, state);
  }
  return state;
}

export function createCommentMutationKey(issueId: string) {
  return ["createComment", issueId] as const;
}

export function useCreateComment(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation({
    // Keyed so the detail screen can read pending submissions back out of
    // the mutation cache (`useMutationState`) and keep their rows on screen
    // across refetches — see lib/pending-comments.ts.
    mutationKey: createCommentMutationKey(issueId),
    // Offline-written comments go out by themselves once the network is back
    //Transient failures retry with backoff, each retry paused
    // while onlineManager is offline; "Retry" only after the last attempt or
    // a real 4xx. Later attempts check the timeline first — no double send.
    retry: shouldAutoResendComment,
    retryDelay: commentResendDelay,
    mutationFn: (vars: CreateCommentVars) =>
      sendCommentAttempt(vars.content, vars.parentId, commentSendState(vars), {
        userId,
        post: () =>
          api.createComment(issueId, vars.content, {
            parentId: vars.parentId,
            attachmentIds: vars.attachmentIds,
            suppressAgentIds: vars.suppressAgentIds,
          }),
        listTimeline: () => api.listTimeline(issueId),
        sessionEpochChanged,
      }),
    onMutate: async (vars) => {
      // Session of the submission, captured before the first await.
      commentSendState(vars);
      const { content, parentId } = vars;
      const key = issueKeys.timeline(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TimelineEntry[]>(key);
      if (!userId) return { prev, key, optimisticId: null, optimistic: null, local: null };

      const optimisticId = newOptimisticCommentId();
      const optimistic: TimelineEntry = {
        type: "comment",
        id: optimisticId,
        actor_type: "member",
        actor_id: userId,
        content,
        parent_id: parentId ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        comment_type: "comment",
        reactions: [],
        attachments: [],
      };

      // ASC list: new comment goes to the end (newest position on screen).
      qc.setQueryData<TimelineEntry[]>(key, (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      // Read back by the screens (`useMutationState`) to show the row exactly
      // once, also when the WS echo beats the POST answer.
      const local: LocalComment = {
        entry: optimistic,
        knownIds: vars.knownIds ?? knownCommentIds(prev),
      };

      return { prev, key, optimisticId, optimistic, local };
    },
    onError: (err, vars, ctx) => {
      // Deliberately do NOT roll back here — the optimistic entry stays in
      // the cache so the user sees an inline "Failed · Retry · Discard"
      // affordance instead of having their typed comment vanish into a
      // toast. The matching failed-comments store entry carries the
      // payload needed to re-fire the same submission. Note: this is the
      // only mutation in the issues file that intentionally avoids
      // rollback — every other path treats error as "undo the optimism".
      // A comment of an ended session must not come back after logout.
      if (err instanceof CommentSessionEndedError) return;
      if (ctx?.optimisticId && ctx.optimistic) {
        useFailedCommentsStore.getState().markFailed(ctx.optimisticId, {
          issueId,
          entry: ctx.optimistic,
          content: vars.content,
          parentId: vars.parentId,
          attachmentIds: vars.attachmentIds,
          suppressAgentIds: vars.suppressAgentIds,
          sentAt: commentSendStates.get(vars)?.since ?? undefined,
          knownIds: ctx.local?.knownIds,
          error: err instanceof Error ? err.message : "Send failed",
        });
      }
    },
    // Invalidate only on success — the failed-comment path needs the cache
    // to keep its optimistic entry so the inline retry UI has something to
    // render against. The synthetic row is swapped for the server row right
    // away (it runs before the mutation leaves "pending", so no frame shows
    // neither or both); the refetch then brings the authoritative list.
    onSuccess: (result, vars, ctx) => {
      // @-suggestions by frequency: only sent comments count.
      noteSentMessage(qc, wsId, vars.content);
      if (wsId && result.kind === "posted") {
        onIssueAuxiliaryRevision(qc, wsId, issueId, result.comment.issue_revision);
      }
      if (ctx?.optimisticId) {
        const server =
          result.kind === "posted" ? commentToTimelineEntry(result.comment) : result.entry;
        qc.setQueryData<TimelineEntry[]>(issueKeys.timeline(wsId, issueId), (old) =>
          settleOptimisticComment(old, ctx.optimisticId!, server),
        );
      }
      qc.invalidateQueries({
        queryKey: issueKeys.timeline(wsId, issueId),
      });
    },
  });
}

/**
 * Drop a failed-but-still-rendered optimistic comment from both the cache
 * and the failed-comments store. Mirrors the Discard half of the inline
 * "Failed · Retry · Discard" affordance on a failed CommentBody.
 */
export function discardFailedComment(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  issueId: string,
  optimisticId: string,
) {
  qc.setQueryData<TimelineEntry[]>(
    issueKeys.timeline(wsId, issueId),
    (old) => (old ? old.filter((e) => e.id !== optimisticId) : old),
  );
  useFailedCommentsStore.getState().clear(optimisticId);
}

/**
 * Toggle a reaction on a comment. Cache target is the timeline infinite
 * query — comment reactions ride on `TimelineEntry.reactions[]` inside each
 * page.entries, so no separate query is involved.
 *
 * Optimistic strategy mirrors useCreateComment: cancel → snapshot → mutate
 * cache → on error rollback → on settle invalidate (so the synthetic
 * reaction id is replaced by the server's real id).
 *
 * Argument shape mirrors web's `ToggleCommentReactionVars` so the eventual
 * migration to the web pattern (useMutationState-derived optimistic state,
 * once WS lands) does not require changing trigger code.
 */
export function useToggleCommentReaction(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation({
    mutationKey: ["toggleCommentReaction", issueId] as const,
    mutationFn: async ({
      commentId,
      emoji,
      existing,
    }: ToggleCommentReactionVars) => {
      if (existing) {
        await api.removeReaction(commentId, emoji);
        return null;
      }
      return api.addReaction(commentId, emoji);
    },
    onMutate: async ({ commentId, emoji, existing }) => {
      const key = issueKeys.timeline(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TimelineEntry[]>(key);
      if (!userId) return { prev, key };

      qc.setQueryData<TimelineEntry[]>(key, (old) => {
        if (!old) return old;
        return old.map((entry) => {
          if (entry.id !== commentId) return entry;
          const reactions = entry.reactions ?? [];
          if (existing) {
            return {
              ...entry,
              reactions: reactions.filter((r) => r.id !== existing.id),
            };
          }
          const optimistic: Reaction = {
            id: `optimistic-${emoji}-${Date.now()}`,
            comment_id: commentId,
            actor_type: "member",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          };
          return { ...entry, reactions: [...reactions, optimistic] };
        });
      });
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSuccess: (reaction, vars) => {
      if (reaction && wsId) {
        advanceCommentRevision(
          qc,
          wsId,
          issueId,
          vars.commentId,
          reaction.comment_revision,
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
    },
  });
}

/**
 * Edit an existing comment. Replaces `content` (and optionally
 * `attachment_ids`) on the server and patches the matching TimelineEntry
 * in the timeline cache. Mirrors web `useEditComment` semantics.
 *
 * Server returns the full updated Comment; we map it into the timeline's
 * TimelineEntry shape (`type: "comment"`, the rest of Comment fields flat).
 */
export function useEditComment(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      commentId,
      content,
      attachmentIds,
      contentBase,
    }: {
      commentId: string;
      content: string;
      attachmentIds?: string[];
      /** Content the user started editing from, for the server's conflict
       *  check. Callers should pass it (as web does): by the time this runs,
       *  `onMutate` has already written the NEW content into the timeline
       *  cache, so the cache lookup below would send the new text as the
       *  base and the server answers 409. */
      contentBase?: string;
    }) => {
      const timeline = qc.getQueryData<TimelineEntry[]>(
        issueKeys.timeline(wsId, issueId),
      );
      return api.updateComment(
        commentId,
        content,
        attachmentIds,
        contentBase ?? commentContentFromTimeline(timeline, commentId),
      );
    },
    onMutate: async ({ commentId, content }) => {
      const key = issueKeys.timeline(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TimelineEntry[]>(key);
      qc.setQueryData<TimelineEntry[]>(key, (old) =>
        old?.map((entry) =>
          entry.type === "comment" && entry.id === commentId
            ? {
                ...entry,
                content,
                updated_at: new Date().toISOString(),
              }
            : entry,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
      showToast({ key: "issues:comments.edit_failed" });
    },
    onSuccess: (comment) => {
      if (wsId) {
        replaceCommentTimelineEntry(
          qc,
          wsId,
          issueId,
          commentToTimelineEntry(comment),
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
    },
  });
}

/**
 * Whether the server keeps a deleted comment's replies (#8296). Older servers
 * omit `comment_delete_keep_replies_supported` and delete the replies too, so
 * anything but an explicit `true` — including a config that has not loaded —
 * fails closed. Shared by the confirm copy and `useDeleteComment`.
 */
export function commentDeleteKeepsReplies(
  config: AppConfigResponse | undefined,
): boolean {
  return config?.comment_delete_keep_replies_supported === true;
}

/**
 * Delete a comment. On a server that declares
 * `comment_delete_keep_replies_supported`, only that comment goes (#8296): one
 * with replies stays as a tombstone so they keep their parent. Older servers
 * delete the replies too. Not optimistic — which outcome applies depends on
 * replies only the server sees for certain. Once it confirms, mirror its
 * outcome with the same pure helpers web uses (`useDeleteComment` in
 * packages/core/issues/mutations.ts); realtime events and the settle refetch
 * reconcile the rest.
 */
export function useDeleteComment(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    // The capability is read when the delete runs, from the same config cache
    // the confirm copy reads, so the route matches what the user was told.
    mutationFn: async (commentId: string) => {
      const keepReplies = commentDeleteKeepsReplies(
        qc.getQueryData(appConfigOptions().queryKey),
      );
      await api.deleteComment(commentId, { keepReplies });
      return keepReplies;
    },
    onSuccess: (keptReplies, commentId) => {
      qc.setQueryData<TimelineEntry[]>(issueKeys.timeline(wsId, issueId), (old) => {
        if (!old) return old;
        return keptReplies
          ? applyCommentDeletion(old, commentId, new Date().toISOString())
          : removeCommentSubtree(old, commentId);
      });
      // The endpoint remains 204 for compatibility, so the local caller has
      // no body carrying issue_revision. The realtime event narrows this
      // with its revision when connected; this is the no-WS safety net.
      if (wsId) invalidateIssueOwnerProjections(qc, wsId, issueId);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
    },
  });
}

/**
 * Resolve / unresolve a comment thread (root comments only — server rejects
 * the call on a reply). Toggle is driven by the `resolved` boolean param:
 * true → POST /resolve, false → DELETE /resolve. Mirrors web
 * `useResolveComment(commentId, resolved)` semantics.
 *
 * Optimistic patch sets `resolved_at` to now (or null on unresolve) so the
 * UI flips immediately; server response replaces with authoritative values.
 */
export function useResolveComment(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      commentId,
      resolved,
    }: {
      commentId: string;
      resolved: boolean;
    }) =>
      resolved
        ? api.resolveComment(commentId)
        : api.unresolveComment(commentId),
    onMutate: async ({ commentId, resolved }) => {
      const key = issueKeys.timeline(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TimelineEntry[]>(key);
      const now = resolved ? new Date().toISOString() : null;
      qc.setQueryData<TimelineEntry[]>(key, (old) =>
        old?.map((entry) =>
          entry.type === "comment" && entry.id === commentId
            ? { ...entry, resolved_at: now }
            : entry,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
      showToast({ key: "issues:comments.edit_failed" });
    },
    onSuccess: (comment) => {
      if (wsId) {
        replaceCommentTimelineEntry(
          qc,
          wsId,
          issueId,
          commentToTimelineEntry(comment),
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
    },
  });
}

/**
 * Toggle a reaction on the issue itself. Cache target is the issue detail
 * query — Issue.reactions is an optional array on the Issue object.
 *
 * Mobile reads issue reactions directly off the detail cache (no separate
 * query like web's issueReactionsOptions). Single source of truth, less
 * code, fewer requests.
 */
export function useToggleIssueReaction(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation({
    mutationKey: ["toggleIssueReaction", issueId] as const,
    mutationFn: async ({ emoji, existing }: ToggleIssueReactionVars) => {
      if (existing) {
        await api.removeIssueReaction(issueId, emoji);
        return null;
      }
      return api.addIssueReaction(issueId, emoji);
    },
    onMutate: async ({ emoji, existing }) => {
      const key = issueKeys.detail(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue>(key);
      if (!userId || !prev) return { prev, key };

      const reactions = prev.reactions ?? [];
      let nextReactions: IssueReaction[];
      if (existing) {
        nextReactions = reactions.filter((r) => r.id !== existing.id);
      } else {
        const optimistic: IssueReaction = {
          id: `optimistic-${emoji}-${Date.now()}`,
          issue_id: issueId,
          actor_type: "member",
          actor_id: userId,
          emoji,
          created_at: new Date().toISOString(),
        };
        nextReactions = [...reactions, optimistic];
      }
      qc.setQueryData<Issue>(key, { ...prev, reactions: nextReactions });
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSuccess: (reaction) => {
      if (reaction && wsId) {
        onIssueAuxiliaryRevision(
          qc,
          wsId,
          issueId,
          reaction.issue_revision,
          "issue_reactions",
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
    },
  });
}

/**
 * Keeps `status_category` consistent with an optimistic `status` write
 * (MUL-6243).
 *
 * A cached issue looks like `{status: "todo", status_category: "unstarted"}` while a
 * patch carries only `{status: "human_review"}`, so a bare spread would leave
 * the STALE category on an issue that no longer behaves that way — and category
 * is what every list groups on. A custom key this response cannot resolve gets
 * `undefined` rather than the inherited value: unresolvable is honest, stale is
 * not, and `issueColumnCategory` falls back from there. The server's full
 * response lands moments later and settles it either way.
 */
function statusCategoryPatch(status: IssueStatus | undefined): Partial<Issue> {
  if (status === undefined) return {};
  return {
    status_category: isBuiltInIssueStatus(status) ? statusCategoryOfKey(status) : undefined,
  };
}

/**
 * Update an issue's editable fields (status / priority / assignee / due_date /
 * project_id / etc). Predictable fields merge optimistically into the detail
 * cache; description stays authoritative because the server resolves it
 * against description_base and hidden channel-media markers. Settle invalidates
 * the my-issues list so a status change re-buckets the SectionList in
 * (tabs)/my-issues.tsx automatically.
 *
 * Mobile cache is flat `Issue[]` (not bucketed `byStatus`), so we DON'T mirror
 * web's `patchIssueInBuckets` rebalancing — settling via `invalidate` is
 * cheaper and produces the same end state.
 */
export function useUpdateIssue(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["updateIssue", issueId] as const,
    mutationFn: (patch: UpdateIssueRequest) => api.updateIssue(issueId, patch),
    onMutate: async (patch) => {
      const key = issueKeys.detail(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue>(key);
      if (prev) {
        const {
          description: _description,
          description_base: _descriptionBase,
          title_base: _titleBase,
          expected_revision: _expectedRevision,
          ...optimisticPatch
        } = patch;
        qc.setQueryData<Issue>(key, {
          ...prev,
          ...optimisticPatch,
          ...statusCategoryPatch(optimisticPatch.status),
        });
      }
      return { prev, key };
    },
    onError: (err, _vars, ctx) => {
      // The rollback below is visible (the chip flips back); say why so a
      // status change that failed offline is not taken back silently.
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
      // A text-baseline conflict is resolved by the edit screen's own
      // dialog; a generic toast on top would contradict it.
      if (!isRevisionConflict(err)) {
        showToast({ key: `issues:${issueUpdateErrorKey(err) ?? "errors.update_failed"}` });
      }
    },
    onSuccess: (server) => {
      qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (current) =>
        !current || shouldAcceptServerRevision(current.revision, server.revision)
          ? server
          : current,
      );
      if (wsId) {
        reconcileIssueFullSnapshotRevision(
          qc,
          wsId,
          issueId,
          server.revision,
        );
      }
    },
    onSettled: (_data, _err, patch, ctx) => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
      qc.invalidateQueries({ queryKey: issueKeys.list(wsId) });
      // Parent / stage changes reorder the sub-issue lists (web does the same).
      for (const parentId of affectedParentIds(ctx?.prev?.parent_issue_id, patch)) {
        qc.invalidateQueries({ queryKey: issueKeys.children(wsId, parentId) });
      }
    },
  });
}

/**
 * Attach a label to the issue. Caller already has the full Label object
 * from the picker, so we don't need to fetch it. Optimistic append to
 * `issue.labels[]`; on success, replace with server-returned full array
 * (handles ordering / dup safety).
 */
export function useAttachLabel(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["attachLabel", issueId] as const,
    mutationFn: ({ label }: { label: Label }) =>
      api.attachLabel(issueId, label.id),
    onMutate: async ({ label }) => {
      const key = issueKeys.detail(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue>(key);
      if (prev) {
        const existing = prev.labels ?? [];
        // Skip dup append — the optimistic case must be idempotent because
        // the picker can fire twice on rapid taps before the request lands.
        if (!existing.some((l) => l.id === label.id)) {
          qc.setQueryData<Issue>(key, {
            ...prev,
            labels: [...existing, label],
          });
        }
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSuccess: (server) => {
      if (wsId) {
        patchIssueLabels(qc, wsId, issueId, server.labels, server.issue_revision);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
    },
  });
}

/** Detach a label. Mirror of useAttachLabel — same invalidation surface. */
export function useDetachLabel(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["detachLabel", issueId] as const,
    mutationFn: ({ labelId }: { labelId: string }) =>
      api.detachLabel(issueId, labelId),
    onMutate: async ({ labelId }) => {
      const key = issueKeys.detail(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue>(key);
      if (prev) {
        const existing = prev.labels ?? [];
        qc.setQueryData<Issue>(key, {
          ...prev,
          labels: existing.filter((l) => l.id !== labelId),
        });
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSuccess: (server) => {
      if (wsId) {
        patchIssueLabels(qc, wsId, issueId, server.labels, server.issue_revision);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
    },
  });
}

/**
 * Issue creation mutation. No optimistic insert — the my-issues list is
 * status-bucketed + scope-filtered (assigned/created/agents), so optimism
 * needs to decide which bucket + scope the row lands in, with rollback.
 * Invalidation is simpler and the hosted server returns in <300ms.
 *
 * Invalidates:
 *  - issueKeys.myAll(wsId)        my-issues list (all three scopes)
 *  - inboxKeys.all(wsId)          inbox (assignment notification if any) —
 *                                 prefix-matches the inbox list key
 */
export function useCreateIssue() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (body: CreateIssueRequest) => api.createIssue(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
      qc.invalidateQueries({ queryKey: inboxKeys.all(wsId) });
    },
  });
}

/**
 * Cancel an in-flight agent task. Optimistically removes the task from the
 * active-tasks cache so the RunRow disappears immediately; the WS
 * `task:cancelled` event then invalidates both task queries (see
 * `use-issue-realtime.ts`) so the task reappears in the past list with the
 * authoritative server state. On error we restore the snapshot.
 */
/**
 * Delete an issue. Mirrors `useDeleteProject` (mutations/projects.ts:103-128)
 * but the cache surface is wider:
 *   - issueKeys.list(wsId)             — workspace-wide flat list
 *   - issueKeys.myList(wsId, ...)      — three scopes × N filter combos
 *
 * Both are flat `Issue[]` caches. We use `setQueriesData` with the
 * `myAll(wsId)` prefix to filter the issue out of every `myList` key in one
 * pass, snapshot the previous data for rollback, and remove the detail /
 * timeline / tasks caches on settle so a stale return-trip can't surface
 * 404-y data.
 *
 * The WS `issue:deleted` event is already handled in `use-issue-realtime.ts`
 * (callers like the detail screen pass `() => router.back()`), so the other
 * tab/client case is covered.
 */
export function useDeleteIssue() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteIssue(id),
    onMutate: async (id) => {
      const listKey = issueKeys.list(wsId);
      const myAllKey = issueKeys.myAll(wsId);
      await Promise.all([
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: myAllKey }),
      ]);

      // Snapshot every matching cache (flat list + each my-issues scope×filter)
      // so we can roll back per-key on error.
      const prevList = qc.getQueryData<Issue[]>(listKey);
      const prevMy = qc.getQueriesData<Issue[]>({ queryKey: myAllKey });

      qc.setQueryData<Issue[]>(listKey, (old) =>
        old ? old.filter((i) => i.id !== id) : old,
      );
      qc.setQueriesData<Issue[]>({ queryKey: myAllKey }, (old) =>
        old ? old.filter((i) => i.id !== id) : old,
      );

      return { prevList, prevMy, listKey, myAllKey };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      if (ctx.prevList !== undefined) {
        qc.setQueryData(ctx.listKey, ctx.prevList);
      }
      for (const [key, value] of ctx.prevMy) {
        qc.setQueryData(key, value);
      }
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: issueKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
      qc.removeQueries({ queryKey: issueKeys.detail(wsId, id) });
      qc.removeQueries({ queryKey: issueKeys.timeline(wsId, id) });
      qc.removeQueries({ queryKey: issueKeys.activeTasks(wsId, id) });
      qc.removeQueries({ queryKey: issueKeys.tasks(wsId, id) });
    },
  });
}

/**
 * "Run again" for a failed / cancelled run (web
 * RetryRunButton). Not optimistic: the new task only exists once the
 * server created it; settle refreshes the active and past runs. A refused
 * re-run (403 invocation_not_allowed) gets its own message.
 */
export function useRerunTask(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (taskId: string) => api.rerunIssue(issueId, taskId),
    onSuccess: () => showToast({ key: "issues:runs.retry_started" }),
    onError: (err) => showToast({ key: `issues:${rerunErrorKey(err)}` }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.activeTasks(wsId, issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) });
    },
  });
}

export function useCancelTask(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (taskId: string) => api.cancelTaskById(taskId),
    onMutate: async (taskId) => {
      const activeKey = issueKeys.activeTasks(wsId, issueId);
      await qc.cancelQueries({ queryKey: activeKey });
      const prev = qc.getQueryData<AgentTask[]>(activeKey);
      qc.setQueryData<AgentTask[]>(activeKey, (old) =>
        old ? old.filter((t) => t.id !== taskId) : old,
      );
      return { prev, activeKey };
    },
    onError: (_err, _taskId, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.activeKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.activeTasks(wsId, issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) });
    },
  });
}
