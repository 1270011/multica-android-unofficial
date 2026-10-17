// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { ChatSession, Issue } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { chatKeys, selectArchivedSessions } from "@/data/queries/chat";
import { movePatch, patchIssueInList, useMoveIssue } from "./issue-move-batch";
import {
  applyPropertiesResponse,
  mergePropertyValue,
  useIssuePropertyMutation,
} from "./issue-properties";
import {
  patchChatSession,
  sortChatSessions,
  useSetChatSessionPinned,
} from "./chat-sessions";

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
    moveIssue: vi.fn(),
    setIssueProperty: vi.fn(),
    unsetIssueProperty: vi.fn(),
    setChatSessionPinned: vi.fn(),
  },
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

const wsId = "ws-1";
const issue = (over: Partial<Issue>) =>
  ({ id: "i-1", status: "todo", properties: {}, ...over }) as Issue;
const session = (over: Partial<ChatSession>) =>
  ({
    id: "s",
    title: "t",
    status: "active",
    has_unread: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  }) as ChatSession;

beforeEach(() => {
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
});
afterEach(() => {
  state.qc.clear();
  vi.clearAllMocks();
});

describe("movePatch / patchIssueInList", () => {
  it("drops neighbour ids and derives the status category", () => {
    expect(movePatch({ status: "done", before_id: "a", after_id: null })).toEqual({
      status: "done",
      status_category: "done",
    });
  });

  it("keeps an explicit null (clear parent) but skips undefined fields", () => {
    expect(
      movePatch({ parent_issue_id: null, project_id: undefined, before_id: null, after_id: null }),
    ).toEqual({ parent_issue_id: null });
  });

  it("leaves lists without the issue untouched (same reference)", () => {
    const list = [issue({ id: "other" })];
    expect(patchIssueInList(list, "i-1", { status: "done" })).toBe(list);
    expect(patchIssueInList([issue({})], "i-1", { status: "done" })?.[0]?.status).toBe("done");
  });
});

describe("useMoveIssue", () => {
  it("patches detail and lists, then rolls back when the server rejects", async () => {
    state.qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue({}));
    state.qc.setQueryData(issueKeys.list(wsId), [issue({})]);
    let reject!: (e: Error) => void;
    vi.mocked(api.moveIssue).mockReturnValue(new Promise((_, r) => (reject = r)));

    const run = useMoveIssue().mutateAsync({
      issueId: "i-1",
      body: { status: "in_review", before_id: null, after_id: null },
    });
    await vi.waitFor(() =>
      expect(state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.status).toBe(
        "in_review",
      ),
    );
    expect(state.qc.getQueryData<Issue[]>(issueKeys.list(wsId))?.[0]?.status).toBe("in_review");

    reject(new Error("409"));
    await expect(run).rejects.toThrow("409");
    expect(state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.status).toBe("todo");
    expect(state.qc.getQueryData<Issue[]>(issueKeys.list(wsId))?.[0]?.status).toBe("todo");
  });
});

describe("useMoveIssue cancellation", () => {
  it("leaves unrelated issue queries (timeline) running", async () => {
    let resolve!: (v: string[]) => void;
    const timeline = state.qc.fetchQuery({
      queryKey: issueKeys.timeline(wsId, "i-1"),
      queryFn: () => new Promise<string[]>((r) => (resolve = r)),
    });
    vi.mocked(api.moveIssue).mockResolvedValue(issue({ status: "done" }));

    await useMoveIssue().mutateAsync({
      issueId: "i-1",
      body: { status: "done", before_id: null, after_id: null },
    });
    resolve(["entry"]);

    await expect(timeline).resolves.toEqual(["entry"]);
  });
});

describe("issue properties", () => {
  it("mergePropertyValue sets and clears single keys without touching others", () => {
    expect(mergePropertyValue({ a: 1 }, "b", "x")).toEqual({ a: 1, b: "x" });
    expect(mergePropertyValue({ a: 1, b: "x" }, "b", undefined)).toEqual({ a: 1 });
    expect(mergePropertyValue(undefined, "a", false)).toEqual({ a: false });
  });

  it("uses the server bag after set, DELETE for undefined values", async () => {
    state.qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue({ properties: { a: 1 } }));
    vi.mocked(api.unsetIssueProperty).mockResolvedValue({
      properties: { z: "server" },
      issue_revision: 7,
    });

    await useIssuePropertyMutation("i-1").mutateAsync({ propertyId: "a" });

    expect(api.unsetIssueProperty).toHaveBeenCalledWith("i-1", "a");
    expect(api.setIssueProperty).not.toHaveBeenCalled();
    expect(
      state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.properties,
    ).toEqual({ z: "server" });
  });
});

describe("applyPropertiesResponse", () => {
  it("ignores the parse fallback (no issue_revision) and keeps the cache", () => {
    const current = issue({ properties: { a: 1 } });
    expect(applyPropertiesResponse(current, { properties: {} })).toBe(current);
    expect(applyPropertiesResponse(current, { properties: {}, issue_revision: 3 })?.properties).toEqual({});
    expect(applyPropertiesResponse(undefined, { properties: {}, issue_revision: 3 })).toBeUndefined();
  });

  it("keeps the optimistic bag when the server answer was the fallback", async () => {
    state.qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue({ properties: { a: 1 } }));
    vi.mocked(api.setIssueProperty).mockResolvedValue({ properties: {} });

    await useIssuePropertyMutation("i-1").mutateAsync({ propertyId: "b", value: "x" });

    expect(
      state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.properties,
    ).toEqual({ a: 1, b: "x" });
  });
});

describe("chat sessions", () => {
  it("sorts pinned first, then by most recent update", () => {
    const sorted = sortChatSessions([
      session({ id: "old" }),
      session({ id: "new", updated_at: "2026-10-05T00:00:00Z" }),
      session({ id: "pin", pinned: true }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["pin", "new", "old"]);
  });

  it("ranks by last message time, falling back to updated_at, like web", () => {
    const sorted = sortChatSessions([
      session({ id: "edited", updated_at: "2026-10-10T00:00:00Z" }),
      session({
        id: "talked",
        updated_at: "2026-10-01T00:00:00Z",
        last_message: { created_at: "2026-10-12T00:00:00Z" } as never,
      }),
      session({ id: "quiet", updated_at: "2026-10-02T00:00:00Z", last_message: null }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["talked", "edited", "quiet"]);
  });

  it("pinned rows: newest pin first when pinned_at is known, else server order", () => {
    const pinnedAt = (id: string, at?: string) =>
      ({ ...session({ id, pinned: true, updated_at: "2026-10-0" + id.length + "T00:00:00Z" }), pinned_at: at }) as never;
    expect(
      sortChatSessions([pinnedAt("a", "2026-10-01T00:00:00Z"), pinnedAt("bb", "2026-10-03T00:00:00Z")]).map((s) => s.id),
    ).toEqual(["bb", "a"]);
    // No pinned_at in the payload: activity does not reorder pinned rows.
    expect(sortChatSessions([pinnedAt("a"), pinnedAt("bb")]).map((s) => s.id)).toEqual(["a", "bb"]);
  });

  it("patchChatSession only touches the matching row", () => {
    const list = [session({ id: "a" }), session({ id: "b" })];
    expect(patchChatSession(list, "b", { title: "x" })?.map((s) => s.title)).toEqual(["t", "x"]);
    expect(patchChatSession(undefined, "b", { title: "x" })).toBeUndefined();
  });

  it("selectArchivedSessions keeps only archived rows", () => {
    expect(
      selectArchivedSessions([session({ id: "a" }), session({ id: "b", status: "archived" })]).map(
        (s) => s.id,
      ),
    ).toEqual(["b"]);
  });

  it("pin is optimistic and re-sorts; rollback restores the old order", async () => {
    const key = chatKeys.sessions(wsId);
    state.qc.setQueryData(key, [
      session({ id: "a", updated_at: "2026-10-05T00:00:00Z" }),
      session({ id: "b" }),
    ]);
    let reject!: (e: Error) => void;
    vi.mocked(api.setChatSessionPinned).mockReturnValue(new Promise((_, r) => (reject = r)));

    const run = useSetChatSessionPinned().mutateAsync({ sessionId: "b", pinned: true });
    await vi.waitFor(() =>
      expect(state.qc.getQueryData<ChatSession[]>(key)?.map((s) => s.id)).toEqual(["b", "a"]),
    );
    reject(new Error("offline"));
    await expect(run).rejects.toThrow("offline");
    expect(state.qc.getQueryData<ChatSession[]>(key)?.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
