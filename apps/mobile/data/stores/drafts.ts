/**
 * Unsent text belongs to the signed-in user and the workspace it was typed
 * in: every session end
 * (secure-storage `clearToken`: logout, 401, failed restore) and every
 * workspace switch (workspace-store) drops the in-memory chat and comment
 * drafts, so the next account on the device never sees them.
 */
import { useChatDraftsStore } from "./chat-drafts-store";
import { useCommentDraftsStore } from "./comment-drafts-store";

export function clearAllDrafts(): void {
  useChatDraftsStore.setState({ drafts: {} });
  useCommentDraftsStore.setState({ drafts: {} });
}
