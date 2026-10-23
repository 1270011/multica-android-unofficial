// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { useIssueSelectionStore } from "@/data/stores/issue-selection-store";
import { showToast } from "@/lib/toast";
import { batchUpdateToast, fieldsPatch, useBatchUpdateIssues } from "./issue-move-batch";

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

vi.mock("@/data/api", () => ({ api: { batchUpdateIssues: vi.fn() } }));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

const wsId = "ws-1";
const issue = (id: string, over: Partial<Issue> = {}) =>
  ({ id, status: "backlog", status_category: "backlog", priority: "none", ...over }) as Issue;
const listKey = issueKeys.myList(wsId, "all", {});
const ids = ["i-1", "i-2", "i-3"];

type Hook = { mutateAsync: (v: unknown) => Promise<unknown> };
const hook = () => useBatchUpdateIssues() as unknown as Hook;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const statuses = () =>
  state.qc.getQueryData<Issue[]>(listKey)?.map((i) => i.status);

beforeEach(() => {
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  state.qc.setQueryData<Issue[]>(listKey, [...ids.map((id) => issue(id)), issue("other")]);
  state.qc.setQueryData<Issue>(issueKeys.detail(wsId, "i-1"), issue("i-1"));
  useIssueSelectionStore.getState().start("i-1");
  useIssueSelectionStore.getState().toggle("i-2");
  useIssueSelectionStore.getState().toggle("i-3");
});
afterEach(() => {
  state.qc.clear();
  useIssueSelectionStore.getState().reset();
  vi.clearAllMocks();
});

describe("batchUpdateToast", () => {
  it("says how many changed, and '2 of 3' when the server skipped some", () => {
    expect(batchUpdateToast(3, 3)).toEqual({
      key: "issues:selection.updated",
      params: { count: 3 },
    });
    expect(batchUpdateToast(3, 2)).toEqual({
      key: "issues:selection.updated_partial",
      params: { count: 2, total: 3 },
    });
  });
});

describe("fieldsPatch", () => {
  it("derives the status category and keeps null for 'nobody'", () => {
    expect(fieldsPatch({ status: "todo" })).toEqual({ status: "todo", status_category: "unstarted" });
    expect(fieldsPatch({ assignee_type: null, assignee_id: null })).toEqual({
      assignee_type: null,
      assignee_id: null,
    });
  });
});

describe("useBatchUpdateIssues", () => {
  it("patches every selected row at once, then ends the selection", async () => {
    const answer = deferred<{ updated: number }>();
    vi.mocked(api.batchUpdateIssues).mockReturnValue(answer.promise);

    const run = hook().mutateAsync({ issueIds: ids, updates: { status: "todo" } });
    await vi.waitFor(() => expect(statuses()).toEqual(["todo", "todo", "todo", "backlog"]));
    expect(state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.status).toBe("todo");
    expect(useIssueSelectionStore.getState().active).toBe(true);

    answer.resolve({ updated: 3 });
    await run;
    expect(api.batchUpdateIssues).toHaveBeenCalledWith(ids, { status: "todo" });
    expect(statuses()).toEqual(["todo", "todo", "todo", "backlog"]);
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.updated",
      params: { count: 3 },
    });
    expect(useIssueSelectionStore.getState()).toMatchObject({ active: false, ids: [] });
  });

  it("partial success: rolls the patch back, says '2 of 3' and ends the selection", async () => {
    vi.mocked(api.batchUpdateIssues).mockResolvedValue({ updated: 2 });

    await hook().mutateAsync({ issueIds: ids, updates: { priority: "high" } });

    expect(state.qc.getQueryData<Issue[]>(listKey)?.map((i) => i.priority)).toEqual([
      "none",
      "none",
      "none",
      "none",
    ]);
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.updated_partial",
      params: { count: 2, total: 3 },
    });
    expect(useIssueSelectionStore.getState().active).toBe(false);
  });

  it("error: rolls back, shows the error text and keeps the selection", async () => {
    vi.mocked(api.batchUpdateIssues).mockRejectedValue(new Error("409 archived"));

    await expect(
      hook().mutateAsync({ issueIds: ids, updates: { status: "done" } }),
    ).rejects.toThrow("409 archived");

    expect(statuses()).toEqual(["backlog", "backlog", "backlog", "backlog"]);
    expect(state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.status).toBe("backlog");
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.update_failed",
      params: { message: "409 archived" },
    });
    expect(useIssueSelectionStore.getState()).toMatchObject({ active: true, ids });
  });
});
