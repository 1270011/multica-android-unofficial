/**
 * "Reply" button under every thread (W1-1).
 *
 * The web app keeps a reply box under each thread, so a reply there carries
 * `parent_id` = thread root and the server starts the thread's agent without
 * an @ (`computeCommentAgentTriggers`: `thread_parent` /
 * `conversation_continuation`). The app's composer posts top-level unless a
 * reply target is set; this button sets it to the thread root, like the
 * long-press "Reply" and the chat swipe do. Never set automatically (F1).
 */
import type { TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "@multica/core/issues/comment-deletion";
import type { ReplyTarget } from "@/data/stores/reply-target-store";
import { isOptimisticCommentId } from "@/lib/pending-comments";

/**
 * Whether a thread with this root gets the button: not for a root that is
 * still sending or failed (no server id to reply to) and not for a deleted
 * root (its placeholder only keeps the replies in place).
 */
export function canReplyToThread(root: TimelineEntry): boolean {
  return root.type === "comment" && !isOptimisticCommentId(root.id) && !isDeletedComment(root);
}

/** Reply target for the composer: the thread root, with the chip's name and preview. */
export function threadReplyTarget(
  root: Pick<TimelineEntry, "id" | "content">,
  actorName: string,
): ReplyTarget {
  return { commentId: root.id, actorName, preview: root.content ?? "" };
}
