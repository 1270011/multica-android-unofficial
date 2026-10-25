/**
 * "Compose a reply to comment X" — read by the inline comment composer,
 * written by the "Reply" button under a thread, the comment long-press
 * action sheet ("Reply") and the chat swipe.
 *
 * The target lives in the issue's comment draft (`comment-drafts-store.ts`,
 * W1-2): it stays until the reply
 * is sent or the chip's ✕ is tapped, and survives scrolling, the keyboard
 * closing, leaving the screen and switching tab or app as long as the draft
 * does. Keyed per issue, so a target can't leak into another issue.
 */
import { useCommentDraftsStore } from "@/data/stores/comment-drafts-store";

export interface ReplyTarget {
  commentId: string;
  /** Display name for the "Replying to X" chip above the input. Resolved
   *  at trigger time via `useActorLookup().getName(actor_type, actor_id)`
   *  so the chip doesn't have to do its own actor lookup. */
  actorName: string;
  /** Raw markdown of the parent comment. The chip renders it via
   *  `stripMarkdown()` + `numberOfLines={2}` so the user sees what they're
   *  replying to without leaving the keyboard. May be empty string for
   *  attachment-only comments. */
  preview: string;
}

export function useReplyTarget(issueId: string): ReplyTarget | null {
  return useCommentDraftsStore((s) => s.drafts[issueId]?.replyTo ?? null);
}

export function getReplyTarget(issueId: string): ReplyTarget | null {
  return useCommentDraftsStore.getState().drafts[issueId]?.replyTo ?? null;
}

export function setReplyTarget(issueId: string, target: ReplyTarget): void {
  useCommentDraftsStore.getState().setReplyTo(issueId, target);
}

export function clearReplyTarget(issueId: string): void {
  useCommentDraftsStore.getState().setReplyTo(issueId, null);
}

/** Drops the target only if it still points at `commentId` (e.g. it was deleted). */
export function clearReplyTargetIf(issueId: string, commentId: string): void {
  if (getReplyTarget(issueId)?.commentId === commentId) clearReplyTarget(issueId);
}
