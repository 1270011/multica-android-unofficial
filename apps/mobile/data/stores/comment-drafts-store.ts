/**
 * Comment composer drafts per issue. In-memory only, like the
 * chat drafts (chat-drafts-store.ts). The tablet detail mounts a different
 * composer for one pane, two panes and "Chat | Activity"; keeping the text
 * here instead of in the composer's state means a rotation across the
 * 840 dp threshold or a pane switch no longer drops a half-typed comment.
 *
 * `editId` marks a draft that edits a comment: the composer pre-fills the
 * comment once per edit target and keeps the user's changes after that.
 * `attachments` keeps picked files (and uploads still running) across the
 * same remounts (J3b); uploads finishing after a remount land here too.
 * `replyTo` is the composer's reply target (W1-2): it belongs to
 * the draft, so it survives everything the draft survives (keyboard, a
 * remount, leaving the screen, switching tab or app) and only goes away on
 * send, on the chip's ✕, when an edit takes over the draft, or on logout.
 */
import { create } from "zustand";
import type { ComposerAttachmentItem } from "@/components/issue/composer-attachment-row";
import type { ReplyTarget } from "@/data/stores/reply-target-store";

export interface CommentDraft {
  text: string;
  /** Comment being edited; absent for a new comment or reply. */
  editId?: string;
  attachments?: ComposerAttachmentItem[];
  /** Comment this draft replies to; absent for a top-level comment. */
  replyTo?: ReplyTarget;
}

const isEmpty = (d: CommentDraft) =>
  d.text === "" && !d.editId && !d.attachments?.length && !d.replyTo;

interface CommentDraftsState {
  drafts: Record<string, CommentDraft>;
  setText: (issueId: string, text: string) => void;
  /** Start editing `commentId` with its current content. */
  startEdit: (issueId: string, commentId: string, content: string) => void;
  /** Functional update, applied to the stored list at call time. */
  updateAttachments: (
    issueId: string,
    update: (prev: ComposerAttachmentItem[]) => ComposerAttachmentItem[],
  ) => void;
  /** Set or (with `null`) drop the reply target; the text stays. */
  setReplyTo: (issueId: string, replyTo: ReplyTarget | null) => void;
  clear: (issueId: string) => void;
}

export const useCommentDraftsStore = create<CommentDraftsState>((set, get) => ({
  drafts: {},
  setText: (issueId, text) => {
    const current = get().drafts[issueId];
    if ((current?.text ?? "") === text) return;
    const next = { ...current, text };
    if (isEmpty(next)) {
      get().clear(issueId);
      return;
    }
    set({ drafts: { ...get().drafts, [issueId]: next } });
  },
  updateAttachments: (issueId, update) => {
    const current = get().drafts[issueId];
    const prev = current?.attachments ?? [];
    const attachments = update(prev);
    if (attachments === prev) return;
    const next = { ...current, text: current?.text ?? "", attachments };
    if (isEmpty(next)) {
      get().clear(issueId);
      return;
    }
    set({ drafts: { ...get().drafts, [issueId]: next } });
  },
  setReplyTo: (issueId, replyTo) => {
    const current = get().drafts[issueId];
    if ((current?.replyTo ?? null) === replyTo) return;
    const next: CommentDraft = { ...current, text: current?.text ?? "" };
    if (replyTo) next.replyTo = replyTo;
    else delete next.replyTo;
    if (isEmpty(next)) {
      get().clear(issueId);
      return;
    }
    set({ drafts: { ...get().drafts, [issueId]: next } });
  },
  startEdit: (issueId, commentId, content) => {
    set({ drafts: { ...get().drafts, [issueId]: { text: content, editId: commentId } } });
  },
  clear: (issueId) => {
    const current = get().drafts;
    if (!(issueId in current)) return;
    const next = { ...current };
    delete next[issueId];
    set({ drafts: next });
  },
}));
