/**
 * A comment sent from the issue chat (and the detail timeline,
 * same data) shows exactly once while it is being sent — whichever arrives
 * first, the `comment:created` echo or the POST answer — and after a failed
 * attempt that is retried.
 */
import { onlineManager, QueryClient } from "@tanstack/react-query";
import type { Comment, TimelineEntry } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { appendTimelineEntry, commentToTimelineEntry } from "@/data/realtime/issue-ws-updaters";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import {
  collectLocalComments,
  isOptimisticCommentId,
  mergeLocalComments,
  type LocalComment,
} from "@/lib/pending-comments";
import { MemoryKv } from "@/data/timeline-cache/memory-kv";
import { readMentionUsage, registerMentionUsageStore } from "@/lib/mention-usage";
import { createCommentMutationKey, discardFailedComment, useCreateComment } from "./issues";

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

const wsId = "workspace-1";
const issueId = "issue-1";
const createComment = vi.mocked(api.createComment);
const listTimeline = vi.mocked(api.listTimeline);

const earlier: TimelineEntry = {
  type: "comment",
  id: "c-old",
  actor_type: "member",
  actor_id: "user-1",
  content: "hello",
  parent_id: null,
  created_at: "2026-10-17T21:59:30Z",
};

function realComment(): Comment {
  return {
    id: "real-1",
    issue_id: issueId,
    author_type: "member",
    author_id: "user-1",
    content: "hello",
    type: "comment",
    parent_id: null,
    reactions: [],
    attachments: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    issue_revision: 7,
  } as unknown as Comment;
}

function timeout() {
  return Object.assign(new Error("Request timed out after 30000ms"), { name: "ApiError", status: 0 });
}

/** What the issue chat / detail renders (same derivation as the screens). */
function visible(): TimelineEntry[] {
  const pending = state.qc
    .getMutationCache()
    .findAll({ mutationKey: createCommentMutationKey(issueId), status: "pending" })
    .map((m) => (m.state.context as { local?: LocalComment | null } | undefined)?.local ?? null);
  const failed = Object.values(useFailedCommentsStore.getState().failed);
  const timeline = state.qc.getQueryData<TimelineEntry[]>(issueKeys.timeline(wsId, issueId));
  return mergeLocalComments(timeline, collectLocalComments(pending, failed, issueId)) ?? [];
}

/** Rows showing the sent text, with their state. */
function hello() {
  return visible()
    .filter((e) => e.content === "hello" && e.id !== earlier.id)
    .map((e) => (isOptimisticCommentId(e.id) ? "sending" : `sent:${e.id}`));
}

/** The `comment:created` broadcast, as use-issue-realtime applies it. */
function wsEcho(comment: Comment) {
  appendTimelineEntry(state.qc, wsId, issueId, commentToTimelineEntry(comment));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("issue chat – the own comment shows exactly once", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T22:00:00Z"));
    state.qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    state.qc.mount();
    // A comment with the same text a moment ago: must not count as the echo.
    state.qc.setQueryData(issueKeys.timeline(wsId, issueId), [earlier]);
    createComment.mockReset();
    listTimeline.mockReset().mockResolvedValue([]);
    useFailedCommentsStore.setState({ failed: {} });
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    state.qc.unmount();
    vi.useRealTimers();
  });

  it("WS event before the POST answer", async () => {
    const post = deferred<Comment>();
    createComment.mockReturnValue(post.promise);
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hello()).toEqual(["sending"]);

    const comment = realComment();
    wsEcho(comment);
    expect(hello()).toEqual(["sent:real-1"]);

    post.resolve(comment);
    await done;
    expect(hello()).toEqual(["sent:real-1"]);
    expect(visible().map((e) => e.id)).toEqual(["c-old", "real-1"]);
  });

  it("POST answer before the WS event", async () => {
    const post = deferred<Comment>();
    createComment.mockReturnValue(post.promise);
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hello()).toEqual(["sending"]);

    const comment = realComment();
    post.resolve(comment);
    await done;
    expect(hello()).toEqual(["sent:real-1"]);

    wsEcho(comment);
    expect(hello()).toEqual(["sent:real-1"]);
  });

  it("slow network: echo, then a refetch without the row, then the answer", async () => {
    const post = deferred<Comment>();
    createComment.mockReturnValue(post.promise);
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    // A reconnect refetch that started before the comment was stored.
    state.qc.setQueryData(issueKeys.timeline(wsId, issueId), [earlier]);
    expect(hello()).toEqual(["sending"]);

    const comment = realComment();
    wsEcho(comment);
    expect(hello()).toEqual(["sent:real-1"]);
    post.resolve(comment);
    await done;
    expect(hello()).toEqual(["sent:real-1"]);
  });

  it("failed attempt, echo during the backoff, retry finds it: no double", async () => {
    // The first POST reached the server but timed out on the client.
    createComment.mockRejectedValueOnce(timeout());
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hello()).toEqual(["sending"]);

    const comment = realComment();
    wsEcho(comment);
    expect(hello()).toEqual(["sent:real-1"]);

    listTimeline.mockResolvedValue([earlier, commentToTimelineEntry(comment)]);
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(hello()).toEqual(["sent:real-1"]);
    expect(useFailedCommentsStore.getState().failed).toEqual({});
  });

  it("manual Retry after the echo arrived: one row, no second POST", async () => {
    createComment.mockRejectedValue(timeout());
    const done = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 15_000);
    await done;
    const [optimisticId, failed] = Object.entries(useFailedCommentsStore.getState().failed)[0]!;
    expect(hello()).toEqual(["sending"]); // rendered as Failed · Retry

    const comment = realComment();
    wsEcho(comment);
    expect(hello()).toEqual(["sent:real-1"]);

    // What the Retry button does (comment-card / chat-bubble).
    listTimeline.mockResolvedValue([earlier, commentToTimelineEntry(comment)]);
    discardFailedComment(state.qc, wsId, issueId, optimisticId);
    const retry = useCreateComment(issueId).mutate({
      content: failed.content,
      parentId: failed.parentId,
      sentAt: failed.sentAt,
      knownIds: failed.knownIds,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(hello()).toEqual(["sent:real-1"]);
    await retry;
    expect(createComment).toHaveBeenCalledTimes(4);
    expect(hello()).toEqual(["sent:real-1"]);
  });

  it("two equal sends in a row stay two rows", async () => {
    const first = deferred<Comment>();
    const second = deferred<Comment>();
    createComment.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = useCreateComment(issueId).mutate({ content: "hello" });
    const b = useCreateComment(issueId).mutate({ content: "hello" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hello()).toEqual(["sending", "sending"]);

    const one = realComment();
    wsEcho(one);
    expect(hello()).toEqual(["sent:real-1", "sending"]);

    const two = { ...realComment(), id: "real-2" } as Comment;
    first.resolve(one);
    second.resolve(two);
    await a;
    await b;
    wsEcho(two);
    expect(hello()).toEqual(["sent:real-1", "sent:real-2"]);
  });
});

describe("@-mention frequency counts only sent comments (A6.5)", () => {
  const mentionText = "hi [@B](mention://agent/b) [@B](mention://agent/b) [@all](mention://all/all)";

  beforeEach(() => {
    state.qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    state.qc.mount();
    createComment.mockReset();
    listTimeline.mockReset().mockResolvedValue([]);
    useFailedCommentsStore.setState({ failed: {} });
    onlineManager.setOnline(true);
    registerMentionUsageStore(new MemoryKv());
  });

  afterEach(() => {
    state.qc.unmount();
  });

  it("a successful send counts each target once", async () => {
    createComment.mockResolvedValue({ ...realComment(), content: mentionText } as Comment);
    await useCreateComment(issueId).mutate({ content: mentionText });
    expect(readMentionUsage(wsId)).toEqual({ "agent:b": { n: 1, last: expect.any(Number) } });
  });

  it("a failed send does not count", async () => {
    createComment.mockRejectedValue(
      Object.assign(new Error("content too long"), { name: "ApiError", status: 422 }),
    );
    await useCreateComment(issueId).mutate({ content: mentionText });
    expect(useFailedCommentsStore.getState().failed).not.toEqual({});
    expect(readMentionUsage(wsId)).toEqual({});
  });

  it("with all actor lists cached, entries of deleted actors go on the next send", async () => {
    registerMentionUsageStore(new MemoryKv());
    state.qc.setQueryData(["members", wsId], [{ user_id: "u-c" }]);
    state.qc.setQueryData(["agents", wsId], [{ id: "b" }]);
    state.qc.setQueryData(["squads", wsId], []);
    createComment.mockResolvedValue({ ...realComment(), content: "x" } as Comment);
    await useCreateComment(issueId).mutate({ content: "[@Gone](mention://agent/gone)" });
    await useCreateComment(issueId).mutate({ content: "[@C](mention://member/u-c)" });
    expect(Object.keys(readMentionUsage(wsId))).toEqual(["member:u-c"]);
  });
});
