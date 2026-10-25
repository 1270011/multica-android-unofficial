/**
 * Suggestion chip "Reply to <agent>" (W1-P4, W1-4/W1-5).
 *
 * When the conversation ends with an agent comment and no reply target is
 * set, the composer offers to reply to that comment. Opened from a
 * notification on an agent comment (`highlight` / `comment` anchor), the
 * anchor is offered instead. Only a tap sets the target; nothing is ever
 * set automatically (F1: a reply to an agent starts a paid run).
 */
import type { TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "@multica/core/issues/comment-deletion";
import { canReplyToThread } from "@/lib/thread-reply";

export interface ReplySuggestion {
  commentId: string;
  agentId: string;
  /** Name from the timeline row; the chip falls back to the actor lookup. */
  actorName: string | undefined;
  preview: string;
}

function isOpenAgentComment(
  entry: TimelineEntry | undefined,
  byId: ReadonlyMap<string, TimelineEntry>,
): entry is TimelineEntry {
  if (!entry || entry.actor_type !== "agent" || !canReplyToThread(entry)) return false;
  // A resolved thread is closed; don't offer to reopen it.
  let root = entry;
  for (let i = 0; root.parent_id && i < 50; i++) {
    const parent = byId.get(root.parent_id);
    if (!parent) break;
    root = parent;
  }
  return !root.resolved_at && !entry.resolved_at;
}

function toSuggestion(entry: TimelineEntry): ReplySuggestion {
  return {
    commentId: entry.id,
    agentId: entry.actor_id,
    actorName: entry.actor_name,
    preview: entry.content ?? "",
  };
}

/**
 * The comment the composer suggests replying to, or null.
 *
 * 1. `anchorId` (notification deep link) on an open agent comment: that one.
 * 2. Otherwise the latest comment, if an agent wrote it. A latest comment by
 *    a person (also one still sending) means no suggestion.
 */
export function suggestReplyTarget(
  entries: readonly TimelineEntry[] | undefined,
  anchorId?: string | null,
): ReplySuggestion | null {
  if (!entries || entries.length === 0) return null;
  const comments = entries.filter((e) => e.type === "comment" && !isDeletedComment(e));
  const byId = new Map(comments.map((c) => [c.id, c]));

  if (anchorId) {
    const anchor = byId.get(anchorId);
    if (isOpenAgentComment(anchor, byId)) return toSuggestion(anchor);
  }

  let last: TimelineEntry | undefined;
  for (const c of comments) {
    if (!last || c.created_at >= last.created_at) last = c;
  }
  return isOpenAgentComment(last, byId) ? toSuggestion(last) : null;
}
