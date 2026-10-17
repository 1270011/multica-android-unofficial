import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueries, setups } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setups: [] as Array<(ws: MockWS, wsId: string) => Array<() => void>>,
}));

type Handler = (payload: unknown) => void;
interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}

vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: (ws: MockWS, wsId: string) => Array<() => void>) => {
    setups.push(setup);
  },
}));
vi.mock("@/data/api", () => ({ api: {} }));

import { invitationKeys } from "@/data/queries/invitations";
import { useInvitationsRealtime } from "./use-invitations-realtime";

describe("useInvitationsRealtime (review #27)", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    setups.length = 0;
  });

  function mount() {
    useInvitationsRealtime();
    const handlers = new Map<string, Handler>();
    let reconnect: (() => void) | undefined;
    const ws: MockWS = {
      on: vi.fn((event: string, h: Handler) => {
        handlers.set(event, h);
        return () => {};
      }),
      onReconnect: vi.fn((h: () => void) => {
        reconnect = h;
        return () => {};
      }),
    };
    setups[0]!(ws, "ws-1");
    return { handlers, reconnect: () => reconnect?.() };
  }

  it("refreshes the pending list on every invitation event and on reconnect", () => {
    const { handlers, reconnect } = mount();
    for (const ev of ["invitation:created", "invitation:revoked", "invitation:declined", "invitation:accepted"]) {
      invalidateQueries.mockClear();
      handlers.get(ev)?.({});
      expect(invalidateQueries, ev).toHaveBeenCalledWith({ queryKey: invitationKeys.mine() });
    }
    invalidateQueries.mockClear();
    reconnect();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: invitationKeys.mine() });
  });

  it("also refreshes the workspace list when an invitation was accepted", () => {
    const { handlers } = mount();
    handlers.get("invitation:accepted")?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
  });
});
