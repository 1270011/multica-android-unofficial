/**
 * Chat session management:
 * which actions a session offers and how a new title is validated. Shared
 * by the long-press menu in the session sheet, the ⋮ menu in the chat
 * header and the TalkBack actions on each row.
 *
 * Mirrors the web thread list (packages/views/chat): active sessions can be
 * renamed, pinned/unpinned, archived and deleted; archived sessions can be
 * restored, renamed and deleted. Pinning an archived session is not offered
 * (web hides pin in the Archived view).
 */
import type { ChatSession } from "@multica/core/types";

export type ChatSessionAction =
  | "rename"
  | "pin"
  | "unpin"
  | "archive"
  | "restore"
  | "delete";

export function chatSessionActions(
  session: Pick<ChatSession, "status" | "pinned">,
): ChatSessionAction[] {
  if (session.status === "archived") return ["restore", "rename", "delete"];
  return ["rename", session.pinned ? "unpin" : "pin", "archive", "delete"];
}

/** Server limit, handler/chat.go `chatSessionTitleMaxLen` (runes). */
export const CHAT_SESSION_TITLE_MAX = 200;

export type TitleCheck =
  | { ok: true; title: string }
  | { ok: false; reason: "empty" | "too_long" | "unchanged" };

/**
 * Same rules as the server (trimmed, not empty, at most 200 characters),
 * plus "unchanged" so Save stays disabled until the title really changes.
 */
export function checkChatSessionTitle(input: string, current: string): TitleCheck {
  const title = input.trim();
  if (!title) return { ok: false, reason: "empty" };
  if ([...title].length > CHAT_SESSION_TITLE_MAX) return { ok: false, reason: "too_long" };
  if (title === current.trim()) return { ok: false, reason: "unchanged" };
  return { ok: true, title };
}

/**
 * The open chat, wherever it is cached: the active
 * list first, then the Archive list, then a single-session read. Without the
 * archived lookups an archived chat resolved to null, so the composer stayed
 * enabled and the ⋮ menu (with Restore) was missing.
 */
export function resolveActiveSession(
  id: string | null,
  active: readonly ChatSession[],
  archived: readonly ChatSession[] | undefined,
  single: ChatSession | null | undefined,
): ChatSession | null {
  if (!id) return null;
  return (
    active.find((s) => s.id === id) ??
    archived?.find((s) => s.id === id) ??
    (single && single.id === id ? single : null)
  );
}

/** True when the open chat is not in the active list (archived or unknown). */
export function needsArchivedLookup(id: string | null, active: readonly ChatSession[]): boolean {
  return !!id && !active.some((s) => s.id === id);
}

/**
 * Delete a chat session (J3b): leave the open chat only after the server
 * confirmed the delete; on failure the chat stays open and the user is told.
 */
export async function deleteChatSessionFlow({
  remove,
  isOpen,
  leave,
  onFailed,
}: {
  remove: () => Promise<unknown>;
  /** Read after the server answered: the user may have switched meanwhile. */
  isOpen: () => boolean;
  leave: () => void;
  onFailed: (err: unknown) => void;
}): Promise<boolean> {
  try {
    await remove();
  } catch (err) {
    onFailed(err);
    return false;
  }
  if (isOpen()) leave();
  return true;
}
