/**
 * Comment trigger preview query. Own prefix outside
 * `issues/<wsId>` like web's issueKeys.commentTriggerPreviewAll(): issue-wide
 * invalidations must not refetch the preview, its answer depends on the
 * draft. Workspace-scoped through wsId.
 */
import { keepPreviousData, queryOptions, type QueryKey } from "@tanstack/react-query";
import type { CommentTriggerPreview } from "@multica/core/types";
import { api } from "@/data/api";
import { EMPTY_COMMENT_TRIGGER_PREVIEW } from "@/data/schemas";
import {
  EMPTY_PREVIEW_SIGNATURE,
  isPreviewUnsupportedError,
} from "@/lib/comment-trigger-preview";

export const commentTriggerPreviewKeys = {
  all: (wsId: string | null) => ["comment-trigger-preview", wsId] as const,
  /** Issue + reply target + edited comment = one composer context. */
  context: (wsId: string | null, issueId: string, parentId: string, editingCommentId: string) =>
    [...commentTriggerPreviewKeys.all(wsId), issueId, parentId, editingCommentId] as const,
  preview: (
    wsId: string | null,
    issueId: string,
    parentId: string,
    editingCommentId: string,
    signature: string,
  ) =>
    [
      ...commentTriggerPreviewKeys.context(wsId, issueId, parentId, editingCommentId),
      signature,
    ] as const,
  /** Session flag: the server answered 404/405/501, stop asking. */
  unsupported: (wsId: string | null) => ["feature-probe", "comment-trigger-preview", wsId] as const,
};

function keyStartsWith(key: QueryKey | undefined, prefix: readonly unknown[]): boolean {
  if (!key || key.length < prefix.length) return false;
  return prefix.every((part, index) => key[index] === part);
}

export interface CommentTriggerPreviewParams {
  wsId: string | null;
  issueId: string;
  parentId?: string;
  editingCommentId?: string;
  /** Debounced mention signature (lib/comment-trigger-preview.ts). */
  signature: string;
  /** Latest draft text; read when the request starts, not when it was keyed. */
  getContent: () => string;
  /** False when the live signature is empty or the server lacks the endpoint. */
  enabled: boolean;
}

export const commentTriggerPreviewOptions = (p: CommentTriggerPreviewParams) => {
  const parentKey = p.parentId ?? "";
  const editingKey = p.editingCommentId ?? "";
  const contextKey = commentTriggerPreviewKeys.context(p.wsId, p.issueId, parentKey, editingKey);
  return queryOptions<CommentTriggerPreview>({
    queryKey: commentTriggerPreviewKeys.preview(p.wsId, p.issueId, parentKey, editingKey, p.signature),
    queryFn: async ({ signal, client }) => {
      try {
        // Forwarding `signal` lets TanStack abort the request once the key
        // moves on (new mention set / reply target): stale answers never land.
        return await api.previewCommentTriggers(p.issueId, p.getContent(), {
          parentId: p.parentId,
          editingCommentId: p.editingCommentId,
          signal,
        });
      } catch (err) {
        if (isPreviewUnsupportedError(err)) {
          client.setQueryData(commentTriggerPreviewKeys.unsupported(p.wsId), true);
          return EMPTY_COMMENT_TRIGGER_PREVIEW;
        }
        throw err;
      }
    },
    enabled:
      p.enabled &&
      !!p.wsId &&
      !!p.issueId &&
      p.signature !== EMPTY_PREVIEW_SIGNATURE,
    retry: false,
    // The answer depends on live queue state (pending-task dedup), so a
    // cached result revalidates when its signature comes back (web parity).
    staleTime: 0,
    // Keep the previous answer only while the SAME composer context
    // refetches; another issue/reply target must not show stale agents.
    placeholderData: (previousData, previousQuery) =>
      keyStartsWith(previousQuery?.queryKey, contextKey)
        ? keepPreviousData(previousData)
        : undefined,
  });
};

/** Observer options for the session "endpoint missing" flag; never fetches. */
export const commentTriggerPreviewUnsupportedOptions = (wsId: string | null) =>
  queryOptions<boolean>({
    queryKey: commentTriggerPreviewKeys.unsupported(wsId),
    queryFn: () => false,
    enabled: false,
    staleTime: Infinity,
  });
