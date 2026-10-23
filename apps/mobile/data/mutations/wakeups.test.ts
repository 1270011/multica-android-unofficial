// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueWakeupsOptions, wakeupKeys } from "@/data/queries/wakeups";
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";
import {
  setWakeupEnabled,
  useDeleteIssueWakeup,
  useToggleIssueWakeup,
  useUpdateIssueSystemWakeup,
} from "./wakeups";

const state = vi.hoisted(() => ({ qc: undefined as unknown as QueryClient }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => state.qc,
    // Real mutation lifecycle; only the React hook wiring is replaced.
    useMutation: (options: ConstructorParameters<typeof actual.MutationObserver>[1]) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return { mutateAsync: (variables: unknown) => observer.mutate(variables) };
    },
  };
});

vi.mock("@/data/api", () => ({
  api: {
    enableIssueWakeup: vi.fn(),
    disableIssueWakeup: vi.fn(),
    deleteIssueWakeup: vi.fn(),
    updateIssueSystemWakeup: vi.fn(),
  },
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

const wsId = "ws-1";
const w = (id: string, enabled: boolean) => ({ id, enabled }) as MobileIssueWakeup;
const listKey = issueWakeupsOptions(wsId, "i-1").queryKey;

beforeEach(() => {
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("wakeup query keys", () => {
  it("scope every key by workspace and nest issue keys", () => {
    expect(wakeupKeys.all("ws-1")).toEqual(["wakeups", "ws-1"]);
    expect(listKey.slice(0, 4)).toEqual(wakeupKeys.issue(wsId, "i-1"));
    expect(wakeupKeys.runs(wsId, "i-1", "w-1").slice(0, 4)).toEqual(wakeupKeys.issue(wsId, "i-1"));
    expect(wakeupKeys.workspace(wsId, { scope: "paused" })).toEqual([
      "wakeups",
      "ws-1",
      "workspace",
      { scope: "paused" },
    ]);
    expect(wakeupKeys.summaries("ws-2")).not.toEqual(wakeupKeys.summaries("ws-1"));
  });
});

describe("wakeup mutations", () => {
  it("setWakeupEnabled patches only the target row", () => {
    expect(setWakeupEnabled([w("a", true), w("b", true)], "b", false)).toEqual([
      w("a", true),
      w("b", false),
    ]);
    expect(setWakeupEnabled(undefined, "b", false)).toBeUndefined();
  });

  it("toggle flips optimistically and rolls back on error", async () => {
    state.qc.setQueryData(listKey, [w("w-1", true)]);
    let reject!: (e: Error) => void;
    vi.mocked(api.disableIssueWakeup).mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const pending = useToggleIssueWakeup("i-1").mutateAsync({ wakeupId: "w-1", enabled: false });
    await vi.waitFor(() =>
      expect(state.qc.getQueryData<MobileIssueWakeup[]>(listKey)?.[0]?.enabled).toBe(false),
    );
    reject(new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
    expect(state.qc.getQueryData<MobileIssueWakeup[]>(listKey)?.[0]?.enabled).toBe(true);
  });

  it("enable sends revision, at and rearm", async () => {
    vi.mocked(api.enableIssueWakeup).mockResolvedValue(null);
    await useToggleIssueWakeup("i-1").mutateAsync({
      wakeupId: "w-1",
      enabled: true,
      revision: 4,
      at: "2026-10-18T08:00:00Z",
    });
    expect(api.enableIssueWakeup).toHaveBeenCalledWith("i-1", "w-1", {
      revision: 4,
      at: "2026-10-18T08:00:00Z",
      rearm: undefined,
    });
  });

  it("delete waits for the server and invalidates the whole wakeup prefix", async () => {
    state.qc.setQueryData(listKey, [w("w-1", true)]);
    state.qc.setQueryData(wakeupKeys.summaries(wsId), []);
    vi.mocked(api.deleteIssueWakeup).mockResolvedValue(undefined);
    await useDeleteIssueWakeup("i-1").mutateAsync("w-1");
    // No optimistic removal: the row stays until the refetch replaces it.
    expect(state.qc.getQueryData<MobileIssueWakeup[]>(listKey)).toHaveLength(1);
    expect(state.qc.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(state.qc.getQueryState(wakeupKeys.summaries(wsId))?.isInvalidated).toBe(true);
  });

  it("system rule update stores the returned list, ignores an empty fallback", async () => {
    const key = wakeupKeys.system(wsId, "i-1");
    state.qc.setQueryData(key, [{ rule: "child_done", enabled: true }]);
    vi.mocked(api.updateIssueSystemWakeup).mockResolvedValueOnce([]);
    await useUpdateIssueSystemWakeup("i-1").mutateAsync({ rule: "child_done", enabled: false });
    expect(state.qc.getQueryData(key)).toEqual([{ rule: "child_done", enabled: true }]);

    vi.mocked(api.updateIssueSystemWakeup).mockResolvedValueOnce([
      { rule: "child_done", enabled: false } as never,
    ]);
    await useUpdateIssueSystemWakeup("i-1").mutateAsync({ rule: "child_done", enabled: false });
    expect(api.updateIssueSystemWakeup).toHaveBeenLastCalledWith("i-1", "child_done", { enabled: false });
    expect(state.qc.getQueryData(key)).toEqual([{ rule: "child_done", enabled: false }]);
  });
});
