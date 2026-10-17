import type { Comment, TimelineEntry } from "@multica/core/types";
import { describe, expect, it, vi } from "vitest";

import {
  COMMENT_AUTO_RETRIES,
  CommentSessionEndedError,
  commentResendDelay,
  findDeliveredComment,
  isTransientSendError,
  sendCommentAttempt,
  shouldAutoResendComment,
  type CommentSendState,
} from "./comment-resend";

function apiError(status: number, name = "ApiError") {
  return Object.assign(new Error(`status ${status}`), { name, status });
}

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "comment",
    id: "c-1",
    actor_type: "member",
    actor_id: "user-1",
    content: "hello",
    parent_id: null,
    created_at: "2026-10-17T10:00:30Z",
    ...over,
  };
}

const probe = { userId: "user-1", content: "hello", since: "2026-10-17T10:00:00Z" };

describe("isTransientSendError", () => {
  it.each([
    ["client timeout (status 0)", apiError(0), true],
    ["408", apiError(408), true],
    ["429", apiError(429), true],
    ["502", apiError(502), true],
    ["network TypeError", new TypeError("Network request failed"), true],
    ["400", apiError(400), false],
    ["403", apiError(403), false],
    ["404", apiError(404), false],
    ["Cloudflare Access block", apiError(200, "AccessBlockedError"), false],
    ["ended session", new CommentSessionEndedError(), false],
  ])("%s → %s", (_label, err, expected) => {
    expect(isTransientSendError(err)).toBe(expected);
  });
});

describe("shouldAutoResendComment / commentResendDelay", () => {
  it("retries transient failures exactly COMMENT_AUTO_RETRIES times", () => {
    const timeout = apiError(0);
    const decisions = [0, 1, 2, 3].map((n) => shouldAutoResendComment(n, timeout));
    expect(decisions).toEqual([true, true, true, false]);
    expect(COMMENT_AUTO_RETRIES).toBe(3);
  });

  it("never retries a 4xx", () => {
    expect(shouldAutoResendComment(0, apiError(422))).toBe(false);
  });

  it("backs off and keeps the last delay", () => {
    expect([0, 1, 2, 7].map(commentResendDelay)).toEqual([2_000, 5_000, 15_000, 15_000]);
  });
});

describe("findDeliveredComment", () => {
  it("finds the own comment with the same text and thread", () => {
    expect(findDeliveredComment([entry()], probe)?.id).toBe("c-1");
  });

  it("ignores whitespace the server may trim", () => {
    expect(findDeliveredComment([entry({ content: "hello\n" })], { ...probe, content: " hello" })).not.toBeNull();
  });

  it.each([
    ["another author", entry({ actor_id: "user-2" })],
    ["an agent", entry({ actor_type: "agent" })],
    ["other text", entry({ content: "hello!" })],
    ["another thread", entry({ parent_id: "root-1" })],
    ["an activity row", entry({ type: "activity" })],
    ["an older comment", entry({ created_at: "2026-10-17T09:50:00Z" })],
  ])("does not match %s", (_label, candidate) => {
    expect(findDeliveredComment([candidate], probe)).toBeNull();
  });

  it("tolerates a device clock ahead of the server", () => {
    expect(findDeliveredComment([entry({ created_at: "2026-10-17T09:59:00Z" })], probe)).not.toBeNull();
  });

  it("matches replies by parent id", () => {
    const reply = entry({ parent_id: "root-1" });
    expect(findDeliveredComment([reply], { ...probe, parentId: "root-1" })).toBe(reply);
  });
});

describe("sendCommentAttempt", () => {
  const posted = { id: "server-1" } as Comment;

  function deps(timeline: TimelineEntry[] = [], epochChanged = false) {
    return {
      userId: "user-1",
      post: vi.fn(async () => posted),
      listTimeline: vi.fn(async () => timeline),
      sessionEpochChanged: vi.fn(() => epochChanged),
      now: () => Date.parse("2026-10-17T10:00:00Z"),
    };
  }

  it("posts straight away on the first attempt and remembers when", async () => {
    const d = deps();
    const state: CommentSendState = { epoch: 1, since: null };
    await expect(sendCommentAttempt("hello", undefined, state, d)).resolves.toEqual({
      kind: "posted",
      comment: posted,
    });
    expect(d.listTimeline).not.toHaveBeenCalled();
    expect(state.since).toBe("2026-10-17T10:00:00.000Z");
  });

  it("takes the row an earlier attempt created instead of posting again", async () => {
    const d = deps([entry()]);
    const state: CommentSendState = { epoch: 1, since: "2026-10-17T10:00:00Z" };
    const result = await sendCommentAttempt("hello", undefined, state, d);
    expect(result).toEqual({ kind: "already-delivered", entry: entry() });
    expect(d.post).not.toHaveBeenCalled();
  });

  it("posts again when the earlier attempt did not arrive", async () => {
    const d = deps([entry({ content: "something else" })]);
    const state: CommentSendState = { epoch: 1, since: "2026-10-17T10:00:00Z" };
    await sendCommentAttempt("hello", undefined, state, d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(state.since).toBe("2026-10-17T10:00:00Z");
  });

  it("refuses to send after the session ended", async () => {
    const d = deps([], true);
    await expect(
      sendCommentAttempt("hello", undefined, { epoch: 1, since: null }, d),
    ).rejects.toBeInstanceOf(CommentSessionEndedError);
    expect(d.post).not.toHaveBeenCalled();
  });
});
