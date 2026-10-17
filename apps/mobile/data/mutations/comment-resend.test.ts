/**
 * offline-written comments go out by themselves when
 * the network is back — through the real TanStack retry/pause machinery.
 */
import { onlineManager, QueryClient } from "@tanstack/react-query";
import type { Comment, TimelineEntry } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { invalidateSessionEpoch } from "@/data/session-epoch";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { useCreateComment } from "./issues";

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => state.qc,
    useMutation: (
      options: ConstructorParameters<typeof actual.MutationObserver>[1],
    ) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return {
        // Like the app's `mutate`: errors end up in onError, not here.
        mutate: (variables: unknown) => observer.mutate(variables).catch(() => undefined),
      };
    },
  };
});

vi.mock("@/data/api", () => ({
  api: { createComment: vi.fn(), listTimeline: vi.fn() },
}));

vi.mock("@/data/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "workspace-1" }),
}));

vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

const issueId = "issue-1";
const createComment = vi.mocked(api.createComment);
const listTimeline = vi.mocked(api.listTimeline);

function timeout() {
  return Object.assign(new Error("Request timed out after 30000ms"), { name: "ApiError", status: 0 });
}

function serverComment(content: string): Comment {
  return { id: "server-1", content, issue_revision: 4 } as Comment;
}

function serverRow(content: string): TimelineEntry {
  return {
    type: "comment",
    id: "server-1",
    actor_type: "member",
    actor_id: "user-1",
    content,
    parent_id: null,
    created_at: new Date().toISOString(),
  };
}

function failed() {
  return Object.values(useFailedCommentsStore.getState().failed);
}

/** What logout does to the queue (auth-store → clearSessionData). */
function logout() {
  invalidateSessionEpoch();
  state.qc.clear();
  useFailedCommentsStore.setState({ failed: {} });
}

describe("useCreateComment – automatic resend after reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    state.qc.mount();
    createComment.mockReset();
    listTimeline.mockReset().mockResolvedValue([]);
    useFailedCommentsStore.setState({ failed: {} });
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    state.qc.unmount();
    vi.useRealTimers();
  });

  it("waits offline, then sends by itself once the network is back", async () => {
    createComment.mockResolvedValue(serverComment("hello"));
    onlineManager.setOnline(false);
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(150_000); // 2.5 min offline
    expect(createComment).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    await done;
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(failed()).toEqual([]);
  });

  it("retries a timeout with backoff and sends without a tap on Retry", async () => {
    createComment.mockRejectedValueOnce(timeout()).mockResolvedValue(serverComment("hello"));
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    expect(createComment).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(createComment).toHaveBeenCalledTimes(2);
    expect(failed()).toEqual([]);
  });

  it("pauses a retry while offline and resumes it on reconnect", async () => {
    createComment.mockRejectedValueOnce(timeout()).mockResolvedValue(serverComment("hello"));
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    onlineManager.setOnline(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(createComment).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(createComment).toHaveBeenCalledTimes(2);
    expect(failed()).toEqual([]);
  });

  it("does not post twice when the timed-out request did reach the server", async () => {
    createComment.mockRejectedValueOnce(timeout());
    listTimeline.mockResolvedValue([serverRow("hello")]);
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(2_000);
    await done;

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(listTimeline).toHaveBeenCalledTimes(1);
    expect(failed()).toEqual([]);
  });

  it("shows Retry at once on a real server error (4xx)", async () => {
    createComment.mockRejectedValue(
      Object.assign(new Error("content too long"), { name: "ApiError", status: 422 }),
    );
    await useCreateComment(issueId).mutate({ content: "hello" });

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(failed()).toMatchObject([{ content: "hello", error: "content too long" }]);
  });

  it("shows Retry once the automatic attempts are used up", async () => {
    createComment.mockRejectedValue(timeout());
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 15_000);
    await done;

    expect(createComment).toHaveBeenCalledTimes(4);
    expect(failed()).toMatchObject([{ content: "hello", sentAt: expect.any(String) }]);
  });

  it("a manual Retry after a timeout checks the server first", async () => {
    listTimeline.mockResolvedValue([serverRow("hello")]);
    await useCreateComment(issueId).mutate({ content: "hello", sentAt: new Date().toISOString() });

    expect(createComment).not.toHaveBeenCalled();
    expect(failed()).toEqual([]);
  });

  it("sends nothing after logout while offline", async () => {
    createComment.mockResolvedValue(serverComment("hello"));
    onlineManager.setOnline(false);
    void useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(10_000);
    logout();

    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createComment).not.toHaveBeenCalled();
    expect(failed()).toEqual([]);
  });

  it("sends nothing after a logout during the backoff", async () => {
    createComment.mockRejectedValueOnce(timeout()).mockResolvedValue(serverComment("hello"));
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    logout();
    await vi.advanceTimersByTimeAsync(30_000);
    await done;

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(listTimeline).not.toHaveBeenCalled();
    expect(failed()).toEqual([]);
  });
});
