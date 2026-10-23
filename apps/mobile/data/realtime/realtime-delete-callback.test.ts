import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatSessionRealtime } from "./use-chat-session-realtime";
import { useProjectRealtime } from "./use-project-realtime";

type EventHandler = (payload: unknown) => void;

interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}

type SubscriptionSetup = (ws: MockWS, wsId: string) => (() => void)[] | undefined;

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  subscriptionSetups: [] as SubscriptionSetup[],
  subscriptionDeps: [] as (readonly unknown[])[],
  ref: null as { current: unknown } | null,
}));

// The hooks run outside a React renderer here. Like React, a ref keeps its box
// across renders (each test mounts one hook with one ref).
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => (state.ref ??= { current: initial }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.qc,
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: SubscriptionSetup, deps: readonly unknown[]) => {
    state.subscriptionSetups.push(setup);
    state.subscriptionDeps.push(deps);
  },
}));

vi.mock("@/data/api", () => ({ api: {} }));

const wsId = "workspace-1";

// The project and chat screens pass their delete callback inline, so
// every render hands the hook a new function. This harness re-renders like
// React does — a changed dep runs the old cleanup and subscribes again — and
// counts the subscriptions on one shared socket.
describe("delete callbacks across re-renders", () => {
  let listeners: Map<string, Set<EventHandler>>;

  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      const set = listeners.get(event) ?? new Set<EventHandler>();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  };

  // Returns a render function; each call renders the hook once with the
  // callback the caller passes, like an inline arrow in the screen.
  function mount(renderHook: (onDeleted: () => void) => void) {
    let deps: readonly unknown[] | null = null;
    let cleanup: (() => void)[] = [];
    return (onDeleted: () => void) => {
      const before = state.subscriptionSetups.length;
      renderHook(onDeleted);
      const setup = state.subscriptionSetups[before];
      const next = state.subscriptionDeps[before];
      const changed =
        deps === null || deps.length !== next.length || deps.some((d, i) => !Object.is(d, next[i]));
      if (changed) {
        for (const u of cleanup) u();
        cleanup = setup(ws, wsId) ?? [];
      }
      deps = next;
    };
  }

  beforeEach(() => {
    listeners = new Map();
    ws.on.mockClear();
    state.ref = null;
    state.qc = new QueryClient();
    state.subscriptionSetups.length = 0;
    state.subscriptionDeps.length = 0;
  });

  const cases = [
    {
      name: "useProjectRealtime",
      id: "project-1",
      render: (onDeleted: () => void) => useProjectRealtime("project-1", onDeleted),
      deleteEvent: "project:deleted",
      deleted: (id: string) => ({ project_id: id }),
    },
    {
      name: "useChatSessionRealtime",
      id: "session-1",
      render: (onDeleted: () => void) => useChatSessionRealtime("session-1", onDeleted),
      deleteEvent: "chat:session_deleted",
      deleted: (id: string) => ({ chat_session_id: id }),
    },
  ] as const;

  it.each(cases)("$name subscribes once across renders with new inline callbacks", (c) => {
    const render = mount(c.render);
    render(() => {});
    const subscribed = ws.on.mock.calls.length;
    expect(subscribed).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) render(() => {});

    expect(ws.on.mock.calls.length).toBe(subscribed);
    expect(listeners.get(c.deleteEvent)?.size).toBe(1);
  });

  it.each(cases)("$name calls the latest callback on delete", (c) => {
    const render = mount(c.render);
    const first = vi.fn();
    const latest = vi.fn();
    render(first);
    render(latest);

    emit(c.deleteEvent, c.deleted(c.id));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("$name ignores deletes of other records", (c) => {
    const render = mount(c.render);
    const onDeleted = vi.fn();
    render(onDeleted);

    emit(c.deleteEvent, c.deleted("other"));

    expect(onDeleted).not.toHaveBeenCalled();
  });
});
