// @vitest-environment node
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { DEFAULT_OVERVIEW_FILTERS } from "@/lib/wakeup-overview";
import { wakeupKeys, workspaceWakeupsPagedOptions } from "./wakeups";

vi.mock("@/data/api", () => ({ api: { listWorkspaceWakeups: vi.fn() } }));

const list = vi.mocked(api.listWorkspaceWakeups);
const counts = { active: 0, all: 0, paused: 0, disabled: 0, ended: 0 };
const pageOf = (n: number, total: number, start: number) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `w-${start + i}` })) as never[],
  total,
  counts,
  agents: [],
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("workspaceWakeupsPagedOptions", () => {
  it("keys by the query parameters, under the workspace prefix", () => {
    const a = workspaceWakeupsPagedOptions("ws-1", DEFAULT_OVERVIEW_FILTERS).queryKey;
    const b = workspaceWakeupsPagedOptions("ws-1", { ...DEFAULT_OVERVIEW_FILTERS, scope: "paused" }).queryKey;
    const c = workspaceWakeupsPagedOptions("ws-1", { ...DEFAULT_OVERVIEW_FILTERS, kind: "at" }).queryKey;
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.slice(0, 3)).toEqual(wakeupKeys.workspaceAll("ws-1"));
  });

  it("sends scope and filters and pages by offset until total", async () => {
    list
      .mockResolvedValueOnce(pageOf(50, 70, 0))
      .mockResolvedValueOnce(pageOf(20, 70, 50));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const state = { scope: "ended" as const, kind: "event" as const, source: "agent" as const, agentId: "a-1", search: " ci " };
    const observer = new InfiniteQueryObserver(qc, workspaceWakeupsPagedOptions("ws-1", state));
    await observer.refetch();
    expect(list).toHaveBeenLastCalledWith(
      { scope: "ended", kind: "event", source: "agent", agent_id: "a-1", search: "ci", offset: 0, limit: 50 },
      expect.anything(),
    );
    expect(observer.getCurrentResult().hasNextPage).toBe(true);

    const second = await observer.fetchNextPage();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50, scope: "ended" }), expect.anything());
    expect(second.data?.pages).toHaveLength(2);
    expect(second.hasNextPage).toBe(false);
  });
});
