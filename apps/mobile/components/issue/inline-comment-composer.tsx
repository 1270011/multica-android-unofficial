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
 *   - Reply target from the issue's draft (`reply-target-store.ts`, set
 *     by "Reply", long-press or swipe). It stays until the reply is sent
 *     or ✕ is tapped (W1-2)
 *   - Trigger chips "Starts: X" above the input: the
 *     preview of the exact content that would be posted; a deselected
 *     agent goes out as `suppress_agent_ids`. Not shown while editing.
 *   - Suggestion chip "Reply to <agent>": with no target
 *     set, offers the latest agent comment (or the notification's anchor);
 *     only a tap sets it as the reply target (F1, `lib/reply-suggestion.ts`)
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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TimelineEntry } from "@multica/core/types";
import { useCreateComment, useEditComment } from "@/data/mutations/issues";
import { clearReplyTarget, setReplyTarget, useReplyTarget } from "@/data/stores/reply-target-store";
import { useEditTargetStore } from "@/data/stores/edit-target-store";
import { useCommentDraftsStore } from "@/data/stores/comment-drafts-store";
import type { ComposerAttachmentItem } from "@/components/issue/composer-attachment-row";
import { useWorkspaceStore } from "@/data/workspace-store";
import { MessageComposer } from "@/components/composer/message-composer";
import { useT } from "@/lib/i18n";
import { useMentionDraftStore } from "@/data/stores/mention-draft-store";
import { CommentTriggerChips } from "@/components/issue/comment-trigger-chips";
import { composeMessageContent } from "@/lib/compose-message-content";
import { useCommentTriggerPreview } from "@/lib/use-comment-trigger-preview";
import { suppressIdsForSubmit, toggleSuppressed } from "@/lib/comment-trigger-chips";
import { ReplySuggestionChip } from "@/components/issue/reply-suggestion-chip";
import { suggestReplyTarget } from "@/lib/reply-suggestion";
import { useActorLookup } from "@/data/use-actor-name";

const NO_ATTACHMENTS: ComposerAttachmentItem[] = [];

export function InlineCommentComposer({
  issueId,
  entries,
  anchorCommentId,
}: {
  issueId: string;
  /** Timeline of the issue, for the "Reply to <agent>" suggestion. */
  entries?: readonly TimelineEntry[];
  /** Comment a notification deep link opened (`highlight` / `comment`). */
  anchorCommentId?: string;
}) {
  const createComment = useCreateComment(issueId);
  const editComment = useEditComment(issueId);
  const { t } = useT("issues");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const replyTarget = useReplyTarget(issueId);
  const onClearReplyTarget = useCallback(() => clearReplyTarget(issueId), [issueId]);
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

  // Trigger preview of what Send would post: chips + typed text, same as
  // MessageComposer's submit. Edits get no preview (web shows one, later).
  const mentions = useMentionDraftStore((s) => s.mentions);
  const draftContent = editTarget ? "" : composeMessageContent(text, mentions);
  const preview = useCommentTriggerPreview({
    issueId,
    parentId: replyTarget?.commentId,
    content: draftContent,
  });
  const [suppressed, setSuppressed] = useState<string[]>([]);
  const onToggleTrigger = useCallback(
    (agentId: string) => setSuppressed((prev) => toggleSuppressed(prev, agentId)),
    [],
  );

  const { getName } = useActorLookup();
  const suggestion = useMemo(
    () => (replyTarget || editTarget ? null : suggestReplyTarget(entries, anchorCommentId)),
    [replyTarget, editTarget, entries, anchorCommentId],
  );
  const suggestionName = suggestion
    ? suggestion.actorName || getName("agent", suggestion.agentId) || t("comments.fallback_actor")
    : "";
  const onTakeSuggestion = useCallback(() => {
    if (!suggestion) return;
    setReplyTarget(issueId, {
      commentId: suggestion.commentId,
      actorName: suggestionName,
      preview: suggestion.preview,
    });
  }, [issueId, suggestion, suggestionName]);

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
        suppressAgentIds: suppressIdsForSubmit(suppressed, preview.agents),
      });
      setSuppressed([]);
      // Sent: the reply is queued with its parent (a failed send retries
      // from the timeline row), so the composer starts over top-level.
      if (replyTarget) clearReplyTarget(issueId);
    },
    [
      createComment,
      editComment,
      editTarget,
      clearEditTarget,
      replyTarget,
      issueId,
      suppressed,
      preview.agents,
    ],
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
      onClearReplyTarget={onClearReplyTarget}
      editTarget={editTarget ? { preview: editTarget.content } : null}
      onCancelEdit={onCancelEdit}
      suggestion={
        suggestion ? (
          <ReplySuggestionChip name={suggestionName} onPress={onTakeSuggestion} />
        ) : null
      }
      accessory={
        editTarget ? null : (
          <CommentTriggerChips
            agents={preview.agents}
            suppressed={suppressed}
            onToggle={onToggleTrigger}
          />
        )
      }
      expandTrigger={
        editTarget ? `edit:${editTarget.commentId}` : replyTarget?.commentId ?? null
      }
    />
  );
}
