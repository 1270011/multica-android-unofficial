import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueries, subscriptionSetups } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  subscriptionSetups: [] as Array<(ws: MockWS, wsId: string) => Array<() => void>>,
}));

type EventHandler = (payload: unknown) => void;

interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: (ws: MockWS, wsId: string) => Array<() => void>) => {
    subscriptionSetups.push(setup);
  },
}));

vi.mock("@/data/api", () => ({ api: {} }));

import { chatKeys } from "@/data/queries/chat";
import { useChatSessionsRealtime } from "./use-chat-sessions-realtime";

describe("useChatSessionsRealtime", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    subscriptionSetups.length = 0;
  });

  it("invalidates the workspace session list for channel-created chats", () => {
    useChatSessionsRealtime();
    expect(subscriptionSetups).toHaveLength(1);

    const handlers = new Map<string, EventHandler>();
    const ws: MockWS = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return () => {};
      }),
      onReconnect: vi.fn(() => () => {}),
    };

    subscriptionSetups[0](ws, "workspace-1");
    handlers.get("chat:session_created")?.({
      workspace_id: "workspace-1",
      chat_session_id: "channel-session-1",
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions("workspace-1"),
    });

    invalidateQueries.mockClear();
    handlers.get("chat:session_created")?.({
      workspace_id: "workspace-2",
      chat_session_id: "other-workspace-session",
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("refreshes the list and marks the session's messages stale on chat:message", () => {
    useChatSessionsRealtime();
    const handlers = new Map<string, EventHandler>();
    const reconnect: Array<() => void> = [];
    const ws: MockWS = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return () => {};
      }),
      onReconnect: vi.fn((cb: () => void) => {
        reconnect.push(cb);
        return () => {};
      }),
    };
    subscriptionSetups[0](ws, "workspace-1");

    handlers.get("chat:message")?.({ chat_session_id: "s1", role: "user" });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions("workspace-1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.messages("s1"),
      refetchType: "none",
    });

    invalidateQueries.mockClear();
    handlers.get("chat:done")?.({ chat_session_id: "s2", task_id: "t" });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: chatKeys.messages("s2"),
      refetchType: "none",
    });

    invalidateQueries.mockClear();
    reconnect.forEach((cb) => cb());
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["chat", "messages"],
    });
  });
});
