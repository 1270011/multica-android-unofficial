// @vitest-environment node
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewCommentTriggers = vi.hoisted(() => vi.fn());
vi.mock("@/data/api", () => ({ api: { previewCommentTriggers } }));

import {
  commentTriggerPreviewKeys,
  commentTriggerPreviewOptions,
  type CommentTriggerPreviewParams,
} from "./comment-trigger-preview";
import { issueKeys } from "./issue-keys";

const WS = "ws-1";
const answer = (name: string) => ({
  agents: [{ id: `id-${name}`, name, source: "issue_assignee", reason: "" }],
  blocked: [],
});

function params(over: Partial<CommentTriggerPreviewParams> = {}): CommentTriggerPreviewParams {
  return {
    wsId: WS,
    issueId: "issue-1",
    signature: "nonempty|",
    getContent: () => "hallo",
    enabled: true,
    ...over,
  };
}

describe("comment trigger preview query", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient();
    previewCommentTriggers.mockReset();
  });

  it("asks with the latest draft, reply target, edited comment and a signal", async () => {
    previewCommentTriggers.mockResolvedValue(answer("A"));
    let text = "erste Fassung";
    const options = commentTriggerPreviewOptions(
      params({ parentId: "c-1", editingCommentId: "c-2", getContent: () => text }),
    );
    text = "zweite Fassung";
    await expect(client.fetchQuery(options)).resolves.toEqual(answer("A"));
    const [issueId, content, opts] = previewCommentTriggers.mock.calls[0]!;
    expect(issueId).toBe("issue-1");
    expect(content).toBe("zweite Fassung");
    expect(opts).toMatchObject({ parentId: "c-1", editingCommentId: "c-2" });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("is disabled for an empty signature, a missing workspace/issue or when switched off", () => {
    const off = [
      params({ signature: "empty" }),
      params({ wsId: null }),
      params({ issueId: "" }),
      params({ enabled: false }),
    ];
    for (const p of off) {
      const observer = new QueryObserver(client, commentTriggerPreviewOptions(p));
      const unsubscribe = observer.subscribe(() => {});
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      unsubscribe();
    }
    expect(previewCommentTriggers).not.toHaveBeenCalled();
  });

  it("aborts the stale request when the mention set changes", async () => {
    const signals: AbortSignal[] = [];
    previewCommentTriggers.mockImplementation(
      (_i: string, _c: string, opts: { signal: AbortSignal }) => {
        signals.push(opts.signal);
        return signals.length === 1
          ? new Promise((_resolve, reject) =>
              opts.signal.addEventListener("abort", () => reject(opts.signal.reason)),
            )
          : Promise.resolve(answer("B"));
      },
    );
    const observer = new QueryObserver(client, commentTriggerPreviewOptions(params()));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    observer.setOptions(commentTriggerPreviewOptions(params({ signature: "nonempty|agent:x" })));
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(answer("B")));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    unsubscribe();
  });

  it("keeps the previous answer as placeholder within the same composer context only", async () => {
    previewCommentTriggers.mockResolvedValueOnce(answer("A"));
    const observer = new QueryObserver(client, commentTriggerPreviewOptions(params()));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(answer("A")));

    previewCommentTriggers.mockReturnValue(new Promise(() => {}));
    observer.setOptions(commentTriggerPreviewOptions(params({ signature: "nonempty|agent:x" })));
    expect(observer.getCurrentResult()).toMatchObject({ data: answer("A"), isPlaceholderData: true });

    observer.setOptions(commentTriggerPreviewOptions(params({ issueId: "issue-2" })));
    expect(observer.getCurrentResult().data).toBeUndefined();
    observer.setOptions(commentTriggerPreviewOptions(params({ parentId: "c-9" })));
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });

  it("turns a missing endpoint into an empty preview and remembers it", async () => {
    previewCommentTriggers.mockRejectedValue(Object.assign(new Error("404 Not Found"), { status: 404 }));
    await expect(client.fetchQuery(commentTriggerPreviewOptions(params()))).resolves.toEqual({
      agents: [],
      blocked: [],
    });
    expect(client.getQueryData(commentTriggerPreviewKeys.unsupported(WS))).toBe(true);
  });

  it("surfaces other errors once without retry and without the unsupported flag", async () => {
    previewCommentTriggers.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(client.fetchQuery(commentTriggerPreviewOptions(params()))).rejects.toThrow("boom");
    expect(previewCommentTriggers).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(commentTriggerPreviewKeys.unsupported(WS))).toBeUndefined();
  });

  it("lives outside the issues prefix, so issue invalidations leave it alone", () => {
    const key = commentTriggerPreviewKeys.preview(WS, "issue-1", "", "", "nonempty|");
    const issuesPrefix = issueKeys.all(WS);
    expect(issuesPrefix.every((part, i) => key[i] === part)).toBe(false);
    expect(key).toEqual(["comment-trigger-preview", WS, "issue-1", "", "", "nonempty|"]);
  });
});
