// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useCommentDraftsStore } from "./comment-drafts-store";
import {
  clearReplyTarget,
  clearReplyTargetIf,
  getReplyTarget,
  setReplyTarget,
} from "./reply-target-store";
import { clearAllDrafts } from "./drafts";

const drafts = () => useCommentDraftsStore.getState();
const target = (commentId: string) => ({ commentId, actorName: "Agent", preview: "hi" });

describe("reply target kept with the draft (W1-2)", () => {
  beforeEach(() => useCommentDraftsStore.setState({ drafts: {} }));

  it("is kept per issue and does not leak into another issue", () => {
    setReplyTarget("a", target("c1"));
    expect(getReplyTarget("a")?.commentId).toBe("c1");
    expect(getReplyTarget("b")).toBeNull();
  });
  it("stays while the text changes and when the text is emptied", () => {
    setReplyTarget("a", target("c1"));
    drafts().setText("a", "half a reply");
    drafts().setText("a", "");
    expect(getReplyTarget("a")?.commentId).toBe("c1");
  });
  it("✕ removes the target and keeps the text", () => {
    drafts().setText("a", "half a reply");
    setReplyTarget("a", target("c1"));
    clearReplyTarget("a");
    expect(getReplyTarget("a")).toBeNull();
    expect(drafts().drafts.a).toEqual({ text: "half a reply" });
  });
  it("✕ on a target without text removes the whole draft", () => {
    setReplyTarget("a", target("c1"));
    clearReplyTarget("a");
    expect(drafts().drafts).toEqual({});
  });
  it("a new target replaces the old one and keeps the text", () => {
    drafts().setText("a", "text");
    setReplyTarget("a", target("c1"));
    setReplyTarget("a", target("c2"));
    expect(drafts().drafts.a).toEqual({ text: "text", replyTo: target("c2") });
  });
  it("send: emptied text plus cleared target leaves no draft", () => {
    setReplyTarget("a", target("c1"));
    drafts().setText("a", "reply");
    drafts().setText("a", "");
    clearReplyTarget("a");
    expect(drafts().drafts).toEqual({});
  });
  it("clearReplyTargetIf only drops a target that points at that comment", () => {
    setReplyTarget("a", target("c1"));
    clearReplyTargetIf("a", "c2");
    expect(getReplyTarget("a")?.commentId).toBe("c1");
    clearReplyTargetIf("a", "c1");
    expect(getReplyTarget("a")).toBeNull();
  });
  it("starting an edit takes over the draft and drops the target", () => {
    setReplyTarget("a", target("c1"));
    drafts().startEdit("a", "c9", "original");
    expect(getReplyTarget("a")).toBeNull();
  });
  it("same target is a no-op", () => {
    const t = target("c1");
    setReplyTarget("a", t);
    const before = drafts().drafts;
    setReplyTarget("a", t);
    expect(drafts().drafts).toBe(before);
  });
  it("logout clears the target with the drafts", () => {
    setReplyTarget("a", target("c1"));
    clearAllDrafts();
    expect(getReplyTarget("a")).toBeNull();
  });
});
