/**
 * "Which agents would this comment start?" for a composer draft
 * (W1-P3a W1-3). Headless: the chips and
 * `suppress_agent_ids` follow in P3b. Web counterpart:
 * packages/views/issues/hooks/use-comment-trigger-preview.ts.
 *
 * - Debounced on the mention signature, so plain typing sends nothing.
 * - A changed key aborts the running request (signal forwarded to fetch).
 * - Errors, offline and a missing endpoint yield an empty preview; the
 *   endpoint check is remembered per workspace for the session.
 * - The preview is a dry run on the server; it never starts a run.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  commentTriggerPreviewOptions,
  commentTriggerPreviewUnsupportedOptions,
} from "@/data/queries/comment-trigger-preview";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  EMPTY_PREVIEW_SIGNATURE,
  commentTriggerPreviewSignature,
  deriveCommentTriggerPreview,
  hasAllMembersMention,
  scheduleSignatureUpdate,
  type CommentTriggerPreviewResult,
} from "./comment-trigger-preview";

export function useCommentTriggerPreview({
  issueId,
  parentId,
  editingCommentId,
  content,
}: {
  issueId: string;
  parentId?: string;
  editingCommentId?: string;
  content: string;
}): CommentTriggerPreviewResult {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const signature = useMemo(() => commentTriggerPreviewSignature(content), [content]);
  const allMembers = useMemo(() => hasAllMembersMention(content), [content]);

  const [debouncedSignature, setDebouncedSignature] = useState(EMPTY_PREVIEW_SIGNATURE);
  useEffect(() => scheduleSignatureUpdate(signature, setDebouncedSignature), [signature]);

  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const { data: unsupported } = useQuery(commentTriggerPreviewUnsupportedOptions(wsId));

  const query = useQuery(
    commentTriggerPreviewOptions({
      wsId,
      issueId,
      parentId,
      editingCommentId,
      signature: debouncedSignature,
      getContent: () => contentRef.current,
      enabled: signature !== EMPTY_PREVIEW_SIGNATURE && unsupported !== true,
    }),
  );

  return deriveCommentTriggerPreview({
    signature,
    debouncedSignature,
    allMembers,
    data: query.data,
    isSuccess: query.isSuccess,
    isPlaceholderData: query.isPlaceholderData,
  });
}
