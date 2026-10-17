/**
 * Screen-scoped state for "edit comment X" — written by the
 * comment long-press menu ("Edit", own comments only, as on web), read by
 * the inline comment composer, which pre-fills the text and submits through
 * `useEditComment` instead of `useCreateComment`.
 *
 * Same shape and lifecycle as `reply-target-store.ts`: a singleton because
 * only one edit can be in flight per issue-detail screen, cleared on unmount
 * of that screen.
 */
import { create } from "zustand";

export interface EditTarget {
  commentId: string;
  /** Raw markdown of the comment as it was when editing started. */
  content: string;
}

interface State {
  target: EditTarget | null;
  setTarget: (target: EditTarget) => void;
  clear: () => void;
}

export const useEditTargetStore = create<State>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
