import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS,
  EMPTY_PREVIEW_SIGNATURE,
  commentTriggerPreviewSignature,
  deriveCommentTriggerPreview,
  hasAllMembersMention,
  isNoteCommentDraft,
  isPreviewUnsupportedError,
  scheduleSignatureUpdate,
} from "./comment-trigger-preview";

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";
const ISSUE = "33333333-3333-4333-8333-333333333333";
const agent = (id: string) => `[@Bot](mention://agent/${id})`;

describe("commentTriggerPreviewSignature", () => {
  it("is empty for blank drafts and /note commands", () => {
    expect(commentTriggerPreviewSignature("")).toBe(EMPTY_PREVIEW_SIGNATURE);
    expect(commentTriggerPreviewSignature("  \n ")).toBe(EMPTY_PREVIEW_SIGNATURE);
    expect(commentTriggerPreviewSignature("/note intern")).toBe(EMPTY_PREVIEW_SIGNATURE);
    expect(commentTriggerPreviewSignature("  /NOTE")).toBe(EMPTY_PREVIEW_SIGNATURE);
  });

  it("does not change while plain text is typed", () => {
    expect(commentTriggerPreviewSignature("H")).toBe("nonempty|");
    expect(commentTriggerPreviewSignature("Hallo Welt")).toBe("nonempty|");
    expect(commentTriggerPreviewSignature("/notes are text")).toBe("nonempty|");
  });

  it("keys on the deduplicated mention set and ignores issue links", () => {
    const sig = commentTriggerPreviewSignature(
      `${agent(AGENT_A)} siehe [MUL-1](mention://issue/${ISSUE}) und ${agent(AGENT_A)} ${agent(AGENT_B)}`,
    );
    expect(sig).toBe(`nonempty|agent:${AGENT_A},agent:${AGENT_B}`);
    expect(commentTriggerPreviewSignature(`x ${agent(AGENT_A)} more text`)).toBe(
      `nonempty|agent:${AGENT_A}`,
    );
  });
});

describe("helpers", () => {
  it("detects @all and /note", () => {
    expect(hasAllMembersMention("[@All](mention://all/all) hi")).toBe(true);
    expect(hasAllMembersMention(agent(AGENT_A))).toBe(false);
    expect(isNoteCommentDraft("\n/note x")).toBe(true);
    expect(isNoteCommentDraft("a /note")).toBe(false);
  });

  it("treats 404/405/501 as a missing endpoint, other errors not", () => {
    expect(isPreviewUnsupportedError({ status: 404 })).toBe(true);
    expect(isPreviewUnsupportedError({ status: 405 })).toBe(true);
    expect(isPreviewUnsupportedError({ status: 501 })).toBe(true);
    expect(isPreviewUnsupportedError({ status: 500 })).toBe(false);
    expect(isPreviewUnsupportedError({ status: 0 })).toBe(false);
    expect(isPreviewUnsupportedError(new Error("offline"))).toBe(false);
    expect(isPreviewUnsupportedError(null)).toBe(false);
  });
});

describe("deriveCommentTriggerPreview", () => {
  const data = {
    agents: [{ id: AGENT_A, name: "A", source: "issue_assignee", reason: "" }],
    blocked: [{ target_type: "agent", target_id: AGENT_B, status: "blocked", reason_code: "x" }],
  };
  const base = {
    signature: "nonempty|",
    debouncedSignature: "nonempty|",
    allMembers: false,
    data,
    isSuccess: true,
    isPlaceholderData: false,
  };

  it("passes a fresh answer through as current", () => {
    expect(deriveCommentTriggerPreview(base)).toEqual({
      agents: data.agents,
      blocked: data.blocked,
      hasAllMembersMention: false,
      isCurrent: true,
    });
  });

  it("shows nothing for an empty draft, which is trivially current", () => {
    const r = deriveCommentTriggerPreview({ ...base, signature: EMPTY_PREVIEW_SIGNATURE, allMembers: true });
    expect(r).toEqual({ agents: [], blocked: [], hasAllMembersMention: true, isCurrent: true });
  });

  it("shows nothing and is not current before the first debounce fired", () => {
    const r = deriveCommentTriggerPreview({ ...base, debouncedSignature: EMPTY_PREVIEW_SIGNATURE });
    expect(r.agents).toEqual([]);
    expect(r.isCurrent).toBe(false);
  });

  it("keeps the previous answer but marks it stale while debouncing or loading", () => {
    expect(deriveCommentTriggerPreview({ ...base, signature: `nonempty|agent:${AGENT_B}` })).toMatchObject({
      agents: data.agents,
      isCurrent: false,
    });
    expect(deriveCommentTriggerPreview({ ...base, isPlaceholderData: true }).isCurrent).toBe(false);
  });

  it("degrades an error or missing data to an empty, non-current preview", () => {
    const r = deriveCommentTriggerPreview({ ...base, data: undefined, isSuccess: false });
    expect(r).toEqual({ agents: [], blocked: [], hasAllMembersMention: false, isCurrent: false });
  });

  it("tolerates an older server without `blocked`", () => {
    const r = deriveCommentTriggerPreview({ ...base, data: { agents: data.agents } });
    expect(r.blocked).toEqual([]);
  });
});

describe("scheduleSignatureUpdate (debounce)", () => {
  afterEach(() => vi.useRealTimers());

  it("applies a non-empty signature only after the debounce delay", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    scheduleSignatureUpdate("nonempty|", apply);
    vi.advanceTimersByTime(COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS - 1);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledWith("nonempty|");
  });

  it("cancels a pending update when the signature changes again (cleanup)", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const cancel = scheduleSignatureUpdate(`nonempty|agent:${AGENT_A}`, apply);
    vi.advanceTimersByTime(200);
    cancel();
    scheduleSignatureUpdate(`nonempty|agent:${AGENT_B}`, apply);
    vi.advanceTimersByTime(COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(`nonempty|agent:${AGENT_B}`);
  });

  it("clears at once for an empty draft", () => {
    const apply = vi.fn();
    scheduleSignatureUpdate(EMPTY_PREVIEW_SIGNATURE, apply);
    expect(apply).toHaveBeenCalledWith(EMPTY_PREVIEW_SIGNATURE);
  });
});
