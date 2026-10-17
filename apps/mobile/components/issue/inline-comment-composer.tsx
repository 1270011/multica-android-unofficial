/**
 * Inline issue-comment composer — thin wrapper around the shared
 * `<MessageComposer>` with comment-specific wiring:
 *
 *   - `onSubmit` → `useCreateComment(issueId).mutate` (fire-and-forget: the
 *     timeline row carries the Sending / Failed · Retry state, so a queued
 * or failed send never blocks the composer — M3)
 *   - Edit mode: `useEditTargetStore` is set by the comment
 *     long-press menu; the composer pre-fills the text, shows an "Editing
 *     comment" chip and submits through `useEditComment` instead.
 *   - Reply target sourced from `useReplyTargetStore` (set by the
 *     comment long-press action sheet)
 *   - Mention picker path → `/[workspace]/mention-picker?mode=comment`
 *   - Upload context binds attachments to this issue
 *   - Text and attachments live in `useCommentDraftsStore` per issue
 *, so a remount (tablet rotation, "Chat | Activity")
 *     keeps the draft
 *
 * All UI / state / chip plumbing lives in `MessageComposer`. The chat
 * composer (`components/chat/chat-composer.tsx`) uses the same component
 * with chat-mode props.
 */
import { useCallback, useEffect } from "react";
import { useCreateComment, useEditComment } from "@/data/mutations/issues";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useEditTargetStore } from "@/data/stores/edit-target-store";
import { useCommentDraftsStore } from "@/data/stores/comment-drafts-store";
import type { ComposerAttachmentItem } from "@/components/issue/composer-attachment-row";
import { useWorkspaceStore } from "@/data/workspace-store";
import { MessageComposer } from "@/components/composer/message-composer";
import { useT } from "@/lib/i18n";

const NO_ATTACHMENTS: ComposerAttachmentItem[] = [];

export function InlineCommentComposer({ issueId }: { issueId: string }) {
  const createComment = useCreateComment(issueId);
  const editComment = useEditComment(issueId);
  const { t } = useT("issues");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const replyTarget = useReplyTargetStore((s) => s.target);
  const clearReplyTarget = useReplyTargetStore((s) => s.clear);
  const editTarget = useEditTargetStore((s) => s.target);
  const clearEditTarget = useEditTargetStore((s) => s.clear);
  // Controlled text so edit mode can pre-fill it and a remount keeps it.
  const text = useCommentDraftsStore((s) => s.drafts[issueId]?.text ?? "");
  // Picked files survive the same remounts as the text.
  const attachments = useCommentDraftsStore((s) => s.drafts[issueId]?.attachments ?? NO_ATTACHMENTS);
  const updateAttachments = useCallback(
    (update: (prev: ComposerAttachmentItem[]) => ComposerAttachmentItem[]) =>
      useCommentDraftsStore.getState().updateAttachments(issueId, update),
    [issueId],
  );
  const setText = useCallback(
    (next: string) => useCommentDraftsStore.getState().setText(issueId, next),
    [issueId],
  );

  useEffect(() => {
    const drafts = useCommentDraftsStore.getState();
    const editId = drafts.drafts[issueId]?.editId;
    if (editTarget) {
      // Pre-fill once per edit target; a remount keeps the user's changes.
      if (editId !== editTarget.commentId) {
        drafts.startEdit(issueId, editTarget.commentId, editTarget.content);
      }
    } else if (editId) {
      // The edit ended (sent, cancelled, screen left): drop its text.
      drafts.clear(issueId);
    }
  }, [editTarget, issueId]);

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds: string[];
    }) => {
      if (editTarget) {
        const target = editTarget;
        clearEditTarget();
        try {
          await editComment.mutateAsync({
            commentId: target.commentId,
            content,
            contentBase: target.content,
          });
        } catch (err) {
          // MessageComposer restores the text on rejection; restore the
          // edit target too so the retry still goes to the same comment.
          useEditTargetStore.getState().setTarget(target);
          throw err;
        }
        return;
      }
      createComment.mutate({
        content,
        parentId: replyTarget?.commentId,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      });
    },
    [createComment, editComment, editTarget, clearEditTarget, replyTarget?.commentId],
  );

  const onCancelEdit = useCallback(() => {
    if (!useEditTargetStore.getState().target) return;
    // The effect above drops the edit text once the target is gone.
    clearEditTarget();
  }, [clearEditTarget]);

  return (
    <MessageComposer
      value={text}
      onChangeText={setText}
      onSubmit={onSubmit}
      mentionPickerPath={{
        pathname: "/[workspace]/mention-picker",
        params: { workspace: wsSlug ?? "", mode: "comment" },
      }}
      uploadContext={{ issueId }}
      attachments={attachments}
      updateAttachments={updateAttachments}
      placeholder={t("comments.composer_placeholder")}
      pillLabel={t("comments.composer_pill")}
      pillIcon="chatbubble-ellipses-outline"
      replyTarget={
        replyTarget && !editTarget
          ? {
              actorName: replyTarget.actorName,
              preview: replyTarget.preview,
            }
          : null
      }
      onClearReplyTarget={clearReplyTarget}
      editTarget={editTarget ? { preview: editTarget.content } : null}
      onCancelEdit={onCancelEdit}
      expandTrigger={
        editTarget ? `edit:${editTarget.commentId}` : replyTarget?.commentId ?? null
      }
    />
  );
}
