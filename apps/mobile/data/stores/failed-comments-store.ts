/**
 * Tracks optimistic-but-failed comment submissions so the timeline can
 * surface an inline "Failed · Retry · Discard" affordance on the row that
 * never made it to the server.
 *
 * The matching optimistic <TimelineEntry> stays in the query cache (the
 * mutation's onError deliberately skips the rollback that would normally
 * snatch it away) — this store carries the metadata needed to re-fire the
 * same submission on Retry, plus an error string for the user.
 *
 * Keyed by the optimistic entry's id (`optimistic-{timestamp}`), which is
 * generated in the mutation's onMutate and threaded back via context. The
 * entry itself plus this store are the two halves of the failed-comment
 * representation — losing either leaves a half-rendered ghost.
 *
 * Session-only — a refresh / pull-to-refresh clears both the optimistic
 * entry (server refetch doesn't include it) and this store entry (timeline
 * remount). Persisting across refresh would require AsyncStorage and
 * server-side draft endpoints, neither in scope for v1.
 */
import { create } from "zustand";
import type { TimelineEntry } from "@multica/core/types";

export interface FailedCommentPayload {
  /** Issue the comment belongs to — lets the detail screen pick its rows. */
  issueId: string;
  /** The optimistic timeline row, so it can be re-appended after a refetch
   *  dropped it from the cache. */
  entry: TimelineEntry;
  /** Markdown body the user typed. Re-used as the content of the retry. */
  content: string;
  /** Thread parent id for reply-mode submissions. */
  parentId?: string;
  /** Attachment ids the user uploaded and referenced in `content`. */
  attachmentIds?: string[];
  /** Deselected agents of the original send; a retry must not start them. */
  suppressAgentIds?: string[];
  /** Time of the first POST that may have reached the server; "Retry"
   *  passes it on so the resend checks for it first. */
  sentAt?: string;
  /** Server comments known at the first send; "Retry" passes them on so
   *  the echo of an earlier attempt is not shown twice. */
  knownIds?: ReadonlySet<string>;
  /** Human-readable error message from the failed mutation — surfaced
   *  inline so the user knows why the send didn't go through. */
  error: string;
}

interface FailedCommentsState {
  /** optimisticId → payload */
  failed: Record<string, FailedCommentPayload>;
  markFailed: (optimisticId: string, payload: FailedCommentPayload) => void;
  /** Remove an entry from the store. Caller is responsible for separately
   *  clearing the matching optimistic <TimelineEntry> from the query cache
   *  (or letting a successful retry's invalidate do it). */
  clear: (optimisticId: string) => void;
}

export const useFailedCommentsStore = create<FailedCommentsState>(
  (set, get) => ({
    failed: {},
    markFailed: (optimisticId, payload) => {
      set({ failed: { ...get().failed, [optimisticId]: payload } });
    },
    clear: (optimisticId) => {
      const current = get().failed;
      if (!(optimisticId in current)) return;
      const next = { ...current };
      delete next[optimisticId];
      set({ failed: next });
    },
  }),
);
