import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@multica/core/types";

import { setSocketLivenessSource } from "@/data/realtime/socket-liveness";
import { AGENT_LIST_POLL_MS, agentListOptions, agentListPollInterval } from "./agents";

vi.mock("@/data/api", () => ({ api: {} }));

const online = { runtime_availability: "online" } as Agent;
const unstable = { runtime_availability: "unstable" } as Agent;
const offline = { runtime_availability: "offline" } as Agent;

describe("agentListPollInterval", () => {
  it("polls unstable agents even with a live socket (ages offline without event)", () => {
    expect(agentListPollInterval([unstable], true)).toBe(AGENT_LIST_POLL_MS);
    expect(agentListPollInterval([online, unstable], true)).toBe(AGENT_LIST_POLL_MS);
    expect(agentListPollInterval([unstable], false)).toBe(AGENT_LIST_POLL_MS);
  });

  it("polls online agents only while the socket is not live", () => {
    expect(agentListPollInterval([online], false)).toBe(AGENT_LIST_POLL_MS);
    expect(agentListPollInterval([online], true)).toBe(false);
  });

  it("never polls offline, unknown, archived or empty lists", () => {
    expect(agentListPollInterval([offline], false)).toBe(false);
    expect(agentListPollInterval([{ runtime_availability: undefined } as Agent], false)).toBe(false);
    expect(
      agentListPollInterval(
        [
          { archived_at: "2026-09-04T00:00:00Z", runtime_availability: "unstable" } as Agent,
          { archived_at: "2026-09-04T00:00:00Z", runtime_availability: "online" } as Agent,
        ],
        false,
      ),
    ).toBe(false);
    expect(agentListPollInterval([], false)).toBe(false);
    expect(agentListPollInterval(undefined, false)).toBe(false);
  });
});

describe("agentListOptions", () => {
  let unregister: (() => void) | undefined;
  afterEach(() => unregister?.());

  it("reads socket liveness at evaluation time and never polls in background", () => {
    const options = agentListOptions("ws-1");
    expect(options.refetchIntervalInBackground).toBe(false);
    const interval = options.refetchInterval;
    expect(typeof interval).toBe("function");
    if (typeof interval !== "function") return;
    const evaluate = () =>
      interval({ state: { status: "success", data: [online] } } as never);

    // No socket registered → fall back to polling.
    expect(evaluate()).toBe(AGENT_LIST_POLL_MS);

    let connectedSince: number | null = 1;
    unregister = setSocketLivenessSource(() => connectedSince);
    expect(evaluate()).toBe(false);

    // Socket dropped (backoff / dialing) → polling resumes.
    connectedSince = null;
    expect(evaluate()).toBe(AGENT_LIST_POLL_MS);
  });
});
