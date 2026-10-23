import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;
interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}
type SubscriptionSetup = (ws: MockWS, wsId: string) => (() => void)[] | undefined;

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  setups: [] as SubscriptionSetup[],
}));

// The hooks run outside a React renderer here; a plain box stands in for the
// callback ref in useChatSessionRealtime.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.qc,
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: SubscriptionSetup) => {
    state.setups.push(setup);
  },
}));
vi.mock("@/data/api", () => ({ api: {} }));

import { chatKeys } from "@/data/queries/chat";
import { useChatSessionRealtime } from "./use-chat-session-realtime";
import { useChatSessionsRealtime } from "./use-chat-sessions-realtime";

const wsId = "ws-1";

function connect() {
  const handlers = new Map<string, EventHandler[]>();
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  for (const setup of state.setups) setup(ws, wsId);
  return (event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h(payload);
  };
}

describe("chat:message live (replaces smoke point 5)", () => {
  beforeEach(() => {
    state.qc = new QueryClient();
    state.setups = [];
    // Same pair as in the app: list hook in the workspace layout, record
    // hook in the open chat screen.
    useChatSessionsRealtime();
    useChatSessionRealtime("open");
  });

  it("refetches the open session's messages and the session list", async () => {
    const fetchMessages = vi.fn(async () => [{ id: "m2" }]);
    const fetchSessions = vi.fn(async () => [{ id: "open" }]);
    const { QueryObserver } = await import("@tanstack/react-query");
    const unsubs = [
      new QueryObserver(state.qc, {
        queryKey: chatKeys.messages("open"),
        queryFn: fetchMessages,
        staleTime: Infinity,
      }).subscribe(() => {}),
      new QueryObserver(state.qc, {
        queryKey: chatKeys.sessions(wsId),
        queryFn: fetchSessions,
        staleTime: Infinity,
      }).subscribe(() => {}),
    ];
    await vi.waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1));

    connect()("chat:message", {
      chat_session_id: "open",
      message_id: "m2",
      role: "user",
      content: "hi",
      created_at: "2026-10-18T00:00:00Z",
    });

    await vi.waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));
    unsubs.forEach((u) => u());
  });

  it("marks a closed session stale without fetching it", () => {
    state.qc.setQueryData(chatKeys.messages("closed"), []);
    connect()("chat:message", { chat_session_id: "closed", role: "user" });
    const s = state.qc.getQueryState(chatKeys.messages("closed"));
    expect(s?.isInvalidated).toBe(true);
    expect(s?.fetchStatus).toBe("idle");
  });
});
