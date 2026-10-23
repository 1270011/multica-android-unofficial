/**
 * Chat tab send path: the user's message shows exactly once.
 *
 * The screen seeds an optimistic bubble into the messages cache and then
 * POSTs. Two other writers race that answer: the `chat:message` broadcast
 * (and every `task:*` event) invalidates the messages query, and the
 * refetched server list replaces the cache — with the real message once it
 * is stored, without it while the request is still on its way. Depending on
 * the order the bubble could show twice (cache row plus server row) or
 * vanish for a moment.
 *
 * The render path therefore takes optimistic rows only from the screen's own
 * list of sends in flight, never from the cache, and drops such a send as
 * soon as its server row is in the list: same session, role "user", same
 * text, not on screen yet when the user pressed send. Each server message
 * absorbs at most one send, so the same text sent twice shows twice.
 */
import type { ChatMessage } from "@multica/core/types";

export const OPTIMISTIC_CHAT_PREFIX = "optimistic-";

/** Device and server clocks differ; an echo may look this much older. */
export const CHAT_ECHO_CLOCK_SLACK_MS = 2 * 60 * 1000;

let seq = 0;

/** Unique even for two sends in the same millisecond. */
export function newOptimisticChatId(now = Date.now()): string {
  seq += 1;
  return `${OPTIMISTIC_CHAT_PREFIX}${now}-${seq}`;
}

export function isOptimisticChatId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_CHAT_PREFIX);
}

/** A message of this client the server has not confirmed yet. */
export interface PendingChatSend {
  message: ChatMessage;
  /** Message ids already in the session when the user pressed send. */
  knownIds: ReadonlySet<string>;
}

export function pendingChatSend(
  message: ChatMessage,
  messages: ChatMessage[] | undefined,
): PendingChatSend {
  const knownIds = new Set<string>();
  for (const m of messages ?? []) if (!isOptimisticChatId(m.id)) knownIds.add(m.id);
  return { message, knownIds };
}

export function isChatEchoOf(server: ChatMessage, send: PendingChatSend): boolean {
  const own = send.message;
  if (isOptimisticChatId(server.id) || send.knownIds.has(server.id)) return false;
  if (server.role !== "user" || server.chat_session_id !== own.chat_session_id) return false;
  if ((server.content ?? "").trim() !== (own.content ?? "").trim()) return false;
  const sent = Date.parse(own.created_at);
  const created = Date.parse(server.created_at);
  if (!Number.isNaN(sent) && !Number.isNaN(created) && created < sent - CHAT_ECHO_CLOCK_SLACK_MS) {
    return false;
  }
  return true;
}

/**
 * What the chat shows: the server list (cache copies of optimistic rows
 * removed) plus every send in flight of this session whose server row is
 * not there yet.
 */
export function mergePendingChatSends(
  messages: ChatMessage[],
  sends: readonly PendingChatSend[],
  sessionId: string | null,
): ChatMessage[] {
  const base = messages.filter((m) => !isOptimisticChatId(m.id));
  const mine = sends.filter((s) => s.message.chat_session_id === sessionId);
  const claimed = new Set<string>();
  const missing: ChatMessage[] = [];
  for (const send of mine) {
    const echo = base.find((m) => !claimed.has(m.id) && isChatEchoOf(m, send));
    if (echo) claimed.add(echo.id);
    else missing.push(send.message);
  }
  if (missing.length === 0) return base.length === messages.length ? messages : base;
  return [...base, ...missing];
}

/**
 * The cache once the POST answered: the optimistic row takes the server id,
 * or simply goes when a refetch already brought the server row.
 */
export function settleChatSend(
  messages: ChatMessage[] | undefined,
  optimisticId: string,
  result: { message_id: string; task_id: string; created_at: string },
): ChatMessage[] | undefined {
  if (!messages) return messages;
  if (messages.some((m) => m.id === result.message_id)) {
    return messages.filter((m) => m.id !== optimisticId);
  }
  return messages.map((m) =>
    m.id === optimisticId
      ? { ...m, id: result.message_id, task_id: result.task_id, created_at: result.created_at }
      : m,
  );
}
