import type { TimelineEntry } from "@multica/core/types";

export function commentContentFromTimeline(
  timeline: TimelineEntry[] | undefined,
  commentId: string,
): string | undefined {
  return timeline?.find(
    (entry) => entry.type === "comment" && entry.id === commentId,
  )?.content;
}

/** POST /api/issues/:id/comments body (server `CreateCommentRequest`,
 *  comment.go:1480). Optional fields are left out when empty, so a plain
 *  top-level comment carries no explicit null; `suppress_agent_ids` lists
 *  the agents the user deselected in the trigger preview (W1-P3b,
 *  same rule as web client.ts createComment). */
export function buildCommentCreateBody(
  content: string,
  opts?: {
    parentId?: string;
    type?: string;
    attachmentIds?: string[];
    suppressAgentIds?: string[];
  },
) {
  return {
    content,
    type: opts?.type ?? "comment",
    ...(opts?.parentId ? { parent_id: opts.parentId } : {}),
    ...(opts?.attachmentIds ? { attachment_ids: opts.attachmentIds } : {}),
    ...(opts?.suppressAgentIds?.length ? { suppress_agent_ids: opts.suppressAgentIds } : {}),
  };
}

export function buildCommentUpdateBody(
  content: string,
  attachmentIds: string[] | undefined,
  contentBase: string | undefined,
) {
  return {
    content,
    ...(attachmentIds ? { attachment_ids: attachmentIds } : {}),
    ...(contentBase !== undefined ? { content_base: contentBase } : {}),
  };
}

export function shouldAcceptServerRevision(
  currentRevision: number | undefined,
  incomingRevision: number | undefined,
): boolean {
  return (
    currentRevision === undefined ||
    (incomingRevision !== undefined && incomingRevision > currentRevision)
  );
}
