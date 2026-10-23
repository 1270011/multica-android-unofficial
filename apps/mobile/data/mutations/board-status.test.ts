// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ qc: undefined as unknown as QueryClient, screenReader: false }));

// Real mutation lifecycle; the observer is never subscribed, exactly like a
// hook whose sheet already closed (per-call onSuccess of an
// unmounted observer never runs).
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => state.qc,
    useMutation: (options: ConstructorParameters<typeof actual.MutationObserver>[1]) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return {
        mutate: (v: unknown, o?: object) => void observer.mutate(v, o).catch(() => {}),
        mutateAsync: (v: unknown, o?: object) => observer.mutate(v, o),
      };
    },
  };
});
vi.mock("react-native", () => ({
  AccessibilityInfo: {
    isScreenReaderEnabled: async () => state.screenReader,
    getRecommendedTimeoutMillis: async (ms: number) => ms * 2,
  },
}));
vi.mock("@/data/api", () => ({ api: { moveIssue: vi.fn() } }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

import { api } from "@/data/api";
import { hideToast, pressToastAction, useToastStore } from "@/lib/toast";
import { statusMoveBody, useBoardStatusChange } from "./board-status";

beforeEach(() => {
  state.qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  state.screenReader = false;
  hideToast();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useBoardStatusChange", () => {
  it("shows the Undo toast although the sheet's observer is gone", async () => {
    vi.mocked(api.moveIssue).mockResolvedValue({ id: "i-1", status: "in_review" } as Issue);
    const change = useBoardStatusChange((label) => `Moved to ${label}`);

    await change("i-1", "todo", "in_review", "In Review");

    expect(api.moveIssue).toHaveBeenCalledWith("i-1", statusMoveBody("in_review"));
    expect(useToastStore.getState().message).toBe("Moved to In Review");
    expect(useToastStore.getState().action?.label).toEqual({ key: "issues:board.undo" });

    pressToastAction();
    await vi.waitFor(() => expect(api.moveIssue).toHaveBeenLastCalledWith("i-1", statusMoveBody("todo")));
    expect(api.moveIssue).toHaveBeenCalledTimes(2);
  });

  it("no Undo toast when the move fails", async () => {
    vi.mocked(api.moveIssue).mockRejectedValue(new Error("500"));
    await useBoardStatusChange(String)("i-1", "todo", "done", "Done");
    expect(useToastStore.getState().action).toBeNull();
  });

  it("does nothing for the same status", async () => {
    await useBoardStatusChange(String)("i-1", "todo", "todo", "Todo");
    expect(api.moveIssue).not.toHaveBeenCalled();
  });

  it("keeps the toast longer with a screen reader on", async () => {
    vi.useFakeTimers();
    state.screenReader = true;
    vi.mocked(api.moveIssue).mockResolvedValue({ id: "i-1" } as Issue);
    await useBoardStatusChange(String)("i-1", "todo", "done", "Done");
    vi.advanceTimersByTime(19_000);
    expect(useToastStore.getState().action).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(useToastStore.getState().action).toBeNull();
  });
});

// Drag & drop uses the same payload: status only, never a position,
// because mobile has no manual sort order.
describe("statusMoveBody (drop payload)", () => {
  it("carries the status and no neighbour ids", () => {
    expect(statusMoveBody("in_review")).toEqual({ status: "in_review", before_id: null, after_id: null });
  });
  // Any sort other than "Manual" never sends a position.
  it("sends no neighbour ids with a sort other than Manual", () => {
    const neighbours = { before_id: "i-2", after_id: "i-3" };
    expect(statusMoveBody("done", { field: "priority", direction: "desc" }, neighbours)).toEqual({
      status: "done",
      before_id: null,
      after_id: null,
    });
    expect(statusMoveBody("done", { field: "position", direction: "asc" }, neighbours)).toEqual({
      status: "done",
      ...neighbours,
    });
  });
});

describe("useBoardStatusChange with a sort", () => {
  it("moves and undoes without before_id/after_id", async () => {
    vi.mocked(api.moveIssue).mockResolvedValue({ id: "i-1" } as Issue);
    await useBoardStatusChange(String, { field: "created_at", direction: "desc" })("i-1", "todo", "done", "Done");
    expect(api.moveIssue).toHaveBeenCalledWith("i-1", { status: "done", before_id: null, after_id: null });
    pressToastAction();
    await vi.waitFor(() =>
      expect(api.moveIssue).toHaveBeenLastCalledWith("i-1", { status: "todo", before_id: null, after_id: null }),
    );
  });
});
