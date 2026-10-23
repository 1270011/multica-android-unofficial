// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import type { MobileAutopilot, MobileAutopilotDetail, MobileAutopilotList } from "@/data/autopilot-schemas";
import { autopilotKeys, nextAutopilotRunsOffset } from "@/data/queries/autopilots";
import {
  setAutopilotStatusInDetail,
  setAutopilotStatusInList,
  useDeleteAutopilot,
  useSetAutopilotStatus,
  useTriggerAutopilot,
} from "./autopilots";

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
    triggerAutopilot: vi.fn(),
    setAutopilotStatus: vi.fn(),
    deleteAutopilot: vi.fn(),
  },
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

const wsId = "ws-1";
const ap = (id: string, status: MobileAutopilot["status"] = "active") =>
  ({ id, status, raw_status: status, pause_reason: null }) as MobileAutopilot;
const list = (...items: MobileAutopilot[]): MobileAutopilotList => ({ autopilots: items, total: items.length });

beforeEach(() => {
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("autopilot query keys", () => {
  it("scope every key by workspace and nest detail keys", () => {
    expect(autopilotKeys.all(wsId)).toEqual(["autopilots", "ws-1"]);
    expect(autopilotKeys.list(wsId)).toEqual(["autopilots", "ws-1", "list", "all"]);
    expect(autopilotKeys.list(wsId, "paused").slice(0, 3)).toEqual(autopilotKeys.lists(wsId));
    expect(autopilotKeys.runs(wsId, "ap-1").slice(0, 4)).toEqual(autopilotKeys.detail(wsId, "ap-1"));
    expect(autopilotKeys.all("ws-2")).not.toEqual(autopilotKeys.all(wsId));
  });

  it("runs paging continues only after a full page", () => {
    const page = (n: number) => ({ runs: Array.from({ length: n }) });
    expect(nextAutopilotRunsOffset(page(20), [page(20)])).toBe(20);
    expect(nextAutopilotRunsOffset(page(20), [page(20), page(20)])).toBe(40);
    expect(nextAutopilotRunsOffset(page(7), [page(20), page(7)])).toBeUndefined();
  });
});

describe("autopilot cache patches", () => {
  it("patch only the target row and clear a system pause reason", () => {
    const paused = { ...ap("b", "paused"), pause_reason: "runtime_offline" };
    expect(setAutopilotStatusInList(list(ap("a"), paused), "b", "active")).toEqual(
      list(ap("a"), { ...paused, status: "active", raw_status: "active", pause_reason: null }),
    );
    expect(setAutopilotStatusInList(undefined, "b", "paused")).toBeUndefined();
    expect(setAutopilotStatusInDetail(null, "paused")).toBeNull();
  });
});

describe("autopilot mutations", () => {
  it("pause flips every cached list and the detail at once", async () => {
    state.qc.setQueryData(autopilotKeys.list(wsId), list(ap("a"), ap("b")));
    state.qc.setQueryData(autopilotKeys.list(wsId, "active"), list(ap("b")));
    state.qc.setQueryData<MobileAutopilotDetail>(autopilotKeys.detail(wsId, "b"), {
      autopilot: ap("b"),
      triggers: [],
      collaborators: [],
    });
    let release!: () => void;
    vi.mocked(api.setAutopilotStatus).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(ap("b", "paused"));
      }),
    );

    const pending = useSetAutopilotStatus().mutateAsync({ id: "b", status: "paused" });
    await vi.waitFor(() => expect(api.setAutopilotStatus).toHaveBeenCalledWith("b", "paused"));

    const statusIn = (key: readonly unknown[]) =>
      state.qc.getQueryData<MobileAutopilotList>(key)?.autopilots.find((a) => a.id === "b")?.status;
    expect(statusIn(autopilotKeys.list(wsId))).toBe("paused");
    expect(statusIn(autopilotKeys.list(wsId, "active"))).toBe("paused");
    expect(
      state.qc.getQueryData<MobileAutopilotDetail>(autopilotKeys.detail(wsId, "b"))?.autopilot.status,
    ).toBe("paused");
    release();
    await pending;
  });

  it("pause rolls lists and detail back when the server refuses", async () => {
    const before = list(ap("a"), ap("b"));
    const detail: MobileAutopilotDetail = { autopilot: ap("b"), triggers: [], collaborators: [] };
    state.qc.setQueryData(autopilotKeys.list(wsId), before);
    state.qc.setQueryData(autopilotKeys.detail(wsId, "b"), detail);
    vi.mocked(api.setAutopilotStatus).mockRejectedValue(new Error("403"));

    await expect(useSetAutopilotStatus().mutateAsync({ id: "b", status: "paused" })).rejects.toThrow("403");
    expect(state.qc.getQueryData(autopilotKeys.list(wsId))).toEqual(before);
    expect(state.qc.getQueryData(autopilotKeys.detail(wsId, "b"))).toEqual(detail);
  });

  it("delete keeps the row until the server confirmed", async () => {
    state.qc.setQueryData(autopilotKeys.list(wsId), list(ap("a"), ap("b")));
    vi.mocked(api.deleteAutopilot).mockRejectedValue(new Error("500"));

    await expect(useDeleteAutopilot().mutateAsync("b")).rejects.toThrow("500");
    expect(
      state.qc.getQueryData<MobileAutopilotList>(autopilotKeys.list(wsId))?.autopilots.map((a) => a.id),
    ).toEqual(["a", "b"]);
  });

  it("delete drops the detail query after success and invalidates the prefix", async () => {
    state.qc.setQueryData(autopilotKeys.detail(wsId, "b"), { autopilot: ap("b"), triggers: [], collaborators: [] });
    vi.mocked(api.deleteAutopilot).mockResolvedValue(undefined);
    const spy = vi.spyOn(state.qc, "invalidateQueries");

    await useDeleteAutopilot().mutateAsync("b");
    expect(state.qc.getQueryData(autopilotKeys.detail(wsId, "b"))).toBeUndefined();
    expect(spy).toHaveBeenCalledWith({ queryKey: autopilotKeys.all(wsId) });
  });

  it("trigger passes the idempotency key and returns the run as is (skipped stays skipped)", async () => {
    const skipped = { id: "r-1", status: "skipped", reason_code: "runtime_offline" };
    vi.mocked(api.triggerAutopilot).mockResolvedValue(skipped as never);

    const res = await useTriggerAutopilot().mutateAsync({ id: "ap-1", idempotencyKey: "k-1" });
    expect(api.triggerAutopilot).toHaveBeenCalledWith("ap-1", { idempotencyKey: "k-1" });
    expect(res).toEqual(skipped);
  });
});
