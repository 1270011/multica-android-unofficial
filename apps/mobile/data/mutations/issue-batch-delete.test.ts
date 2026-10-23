// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { useIssueSelectionStore } from "@/data/stores/issue-selection-store";
import { showToast } from "@/lib/toast";
import { batchDeleteToast, useBatchDeleteIssues } from "./issue-move-batch";

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

vi.mock("@/data/api", () => ({ api: { batchDeleteIssues: vi.fn() } }));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

const wsId = "ws-1";
const issue = (id: string) => ({ id, status: "todo", priority: "none" }) as Issue;
const listKey = issueKeys.myList(wsId, "all", {});
const ids = ["i-1", "i-2", "i-3"];

type Hook = { mutateAsync: (v: unknown) => Promise<unknown> };
const hook = () => useBatchDeleteIssues() as unknown as Hook;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rows = () => state.qc.getQueryData<Issue[]>(listKey)?.map((i) => i.id);

beforeEach(() => {
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  state.qc.setQueryData<Issue[]>(listKey, [...ids.map(issue), issue("other")]);
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

describe("batchDeleteToast", () => {
  it("says how many were deleted, and '2 of 3' when the server skipped some", () => {
    expect(batchDeleteToast(3, 3)).toEqual({
      key: "issues:selection.deleted",
      params: { count: 3 },
    });
    expect(batchDeleteToast(3, 2)).toEqual({
      key: "issues:selection.deleted_partial",
      params: { count: 2, total: 3 },
    });
  });
});

describe("useBatchDeleteIssues", () => {
  it("is not optimistic: rows stay until the server answers, then go", async () => {
    const answer = deferred<{ deleted: number }>();
    vi.mocked(api.batchDeleteIssues).mockReturnValue(answer.promise);

    const run = hook().mutateAsync([...ids]);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.batchDeleteIssues).toHaveBeenCalledWith(ids);
    expect(rows()).toEqual([...ids, "other"]);
    expect(useIssueSelectionStore.getState().ids).toEqual(ids);

    answer.resolve({ deleted: 3 });
    await run;
    expect(rows()).toEqual(["other"]);
    expect(state.qc.getQueryData(issueKeys.detail(wsId, "i-1"))).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.deleted",
      params: { count: 3 },
    });
    expect(useIssueSelectionStore.getState().active).toBe(false);
  });

  it("on partial success re-reads the list and keeps the issues still there selected", async () => {
    vi.mocked(api.batchDeleteIssues).mockResolvedValue({ deleted: 2 });
    // The re-read list: i-2 survived (server skipped it).
    const fetchList = vi.fn().mockResolvedValue([issue("i-2"), issue("other")]);
    state.qc.getQueryCache().find({ queryKey: listKey })!.setOptions({
      queryKey: listKey,
      queryFn: fetchList,
    });

    await hook().mutateAsync([...ids]);

    expect(fetchList).toHaveBeenCalled();
    expect(rows()).toEqual(["i-2", "other"]);
    const selection = useIssueSelectionStore.getState();
    expect(selection.active).toBe(true);
    expect(selection.ids).toEqual(["i-2"]);
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.deleted_partial",
      params: { count: 2, total: 3 },
    });
  });

  it("on error changes nothing and keeps the selection", async () => {
    vi.mocked(api.batchDeleteIssues).mockRejectedValue(new Error("offline"));

    await expect(hook().mutateAsync([...ids])).rejects.toThrow("offline");

    expect(rows()).toEqual([...ids, "other"]);
    expect(useIssueSelectionStore.getState().ids).toEqual(ids);
    expect(showToast).toHaveBeenCalledWith({
      key: "issues:selection.delete_failed",
      params: { message: "offline" },
    });
  });
});
