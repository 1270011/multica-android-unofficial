/**
 * Chat tab: the user's message shows exactly once while it is
 * sent, in every order of POST answer and `chat:message` refetch. Drives
 * the cache transitions of the chat tab send path (tabs/chat.tsx) through
 * the same helpers the screen uses; nothing is sent to an agent.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import {
  isOptimisticChatId,
  mergePendingChatSends,
  newOptimisticChatId,
  pendingChatSend,
  settleChatSend,
  type PendingChatSend,
} from "./chat-send";

const session = "s1";

function msg(id: string, content: string, created_at: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { id, chat_session_id: session, role, content, task_id: null, created_at };
}

const history = [
  msg("m1", "hello", "2026-10-17T21:59:30Z"),
  msg("m2", "answer", "2026-10-17T21:59:40Z", "assistant"),
];

/** Small model of the chat tab: messages cache + sends in flight. */
function chatTab(initial: ChatMessage[]) {
  let cache: ChatMessage[] | undefined = initial;
  let sends: PendingChatSend[] = [];
  return {
    send(content: string, sentAt: string) {
      const optimistic = msg(newOptimisticChatId(), content, sentAt);
      const send = pendingChatSend(optimistic, cache);
      sends = [...sends, send];
      cache = cache ? [...cache, optimistic] : [optimistic];
      return {
        answer(result: { message_id: string; created_at: string }) {
          cache = settleChatSend(cache, optimistic.id, { ...result, task_id: "t1" });
          sends = sends.filter((s) => s !== send);
        },
        fail() {
          cache = cache?.filter((m) => m.id !== optimistic.id);
          sends = sends.filter((s) => s !== send);
        },
      };
    },
    /** Invalidate + refetch (chat:message, task:* events). */
    refetch(server: ChatMessage[]) {
      cache = server;
    },
    rows(content: string) {
      return mergePendingChatSends(cache ?? [], sends, session)
        .filter((m) => m.content === content && m.id !== "m1")
        .map((m) => (isOptimisticChatId(m.id) ? "sending" : `sent:${m.id}`));
    },
  };
}

const real = msg("real-1", "hello", "2026-10-17T22:00:01Z");

describe("chat tab – the own message shows exactly once", () => {
  it("chat:message refetch before the POST answer", () => {
    const tab = chatTab(history);
    const send = tab.send("hello", "2026-10-17T22:00:00Z");
    expect(tab.rows("hello")).toEqual(["sending"]);

    tab.refetch([...history, real]);
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);

    send.answer({ message_id: "real-1", created_at: real.created_at });
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);
  });

  it("POST answer before the chat:message refetch", () => {
    const tab = chatTab(history);
    const send = tab.send("hello", "2026-10-17T22:00:00Z");
    send.answer({ message_id: "real-1", created_at: real.created_at });
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);

    tab.refetch([...history, real]);
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);
  });

  it("slow network: a refetch without the message does not hide it", () => {
    const tab = chatTab(history);
    const send = tab.send("hello", "2026-10-17T22:00:00Z");
    tab.refetch(history); // task:dispatch of the previous turn
    expect(tab.rows("hello")).toEqual(["sending"]);
    send.answer({ message_id: "real-1", created_at: real.created_at });
    tab.refetch([...history, real]);
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);
  });

  it("failed send and a new attempt: one row, never two", () => {
    const tab = chatTab(history);
    const first = tab.send("hello", "2026-10-17T22:00:00Z");
    first.fail();
    expect(tab.rows("hello")).toEqual([]);

    const second = tab.send("hello", "2026-10-17T22:00:05Z");
    expect(tab.rows("hello")).toEqual(["sending"]);
    tab.refetch([...history, real]);
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);
    second.answer({ message_id: "real-1", created_at: real.created_at });
    expect(tab.rows("hello")).toEqual(["sent:real-1"]);
  });

  it("keeps two equal messages apart and ignores the older one with the same text", () => {
    const tab = chatTab(history);
    tab.send("hello", "2026-10-17T22:00:00Z");
    tab.send("hello", "2026-10-17T22:00:00Z");
    tab.refetch([...history, real]);
    expect(tab.rows("hello")).toEqual(["sent:real-1", "sending"]);
  });

  it("does not take the echo from another session or the assistant", () => {
    const tab = chatTab(history);
    tab.send("hello", "2026-10-17T22:00:00Z");
    tab.refetch([
      ...history,
      { ...real, id: "x1", chat_session_id: "s2" },
      { ...real, id: "x2", role: "assistant" },
    ]);
    // Both foreign rows stay, and the own send is still shown as sending.
    expect(tab.rows("hello")).toEqual(["sent:x1", "sent:x2", "sending"]);
  });
});

describe("settleChatSend", () => {
  const optimistic = msg("optimistic-1", "hello", "2026-10-17T22:00:00Z");
  const result = { message_id: "real-1", task_id: "t1", created_at: real.created_at };

  it("gives the optimistic row the server id", () => {
    expect(settleChatSend([optimistic], "optimistic-1", result)).toEqual([
      { ...optimistic, id: "real-1", task_id: "t1", created_at: real.created_at },
    ]);
  });

  it("drops it when a refetch already brought the server row", () => {
    expect(settleChatSend([optimistic, real], "optimistic-1", result)).toEqual([real]);
  });
});

describe("mergePendingChatSends", () => {
  it("returns the list unchanged when nothing is in flight", () => {
    expect(mergePendingChatSends(history, [], session)).toBe(history);
  });

  it("ignores sends of another session", () => {
    const other = pendingChatSend({ ...msg("optimistic-9", "x", "2026-10-17T22:00:00Z"), chat_session_id: "s2" }, []);
    expect(mergePendingChatSends(history, [other], session)).toBe(history);
  });
});
