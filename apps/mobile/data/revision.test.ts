import type { TimelineEntry } from "@multica/core/types";
import { describe, expect, it } from "vitest";

import {
  buildCommentCreateBody,
  buildCommentUpdateBody,
  commentContentFromTimeline,
  shouldAcceptServerRevision,
} from "./revision";

describe("mobile revision requests", () => {
  it("sends suppress_agent_ids for deselected trigger chips only when set (W1-P3b)", () => {
    expect(buildCommentCreateBody("Hi")).toEqual({ content: "Hi", type: "comment" });
    expect(buildCommentCreateBody("Hi", { suppressAgentIds: [] })).toEqual({
      content: "Hi",
      type: "comment",
    });
    expect(
      buildCommentCreateBody("Hi", {
        parentId: "c1",
        attachmentIds: ["f1"],
        suppressAgentIds: ["a1", "a2"],
      }),
    ).toEqual({
      content: "Hi",
      type: "comment",
      parent_id: "c1",
      attachment_ids: ["f1"],
      suppress_agent_ids: ["a1", "a2"],
    });
  });

  it("reads the edited comment content and serializes it as the field baseline", () => {
    const timeline = [
      {
        type: "comment",
        id: "comment-1",
        content: "Original",
      } as TimelineEntry,
    ];

    expect(commentContentFromTimeline(timeline, "comment-1")).toBe("Original");
    expect(buildCommentUpdateBody("Latest", ["attachment-1"], "Original")).toEqual({
      content: "Latest",
      attachment_ids: ["attachment-1"],
      content_base: "Original",
    });
  });

  it("does not let an older HTTP response overwrite a newer cache revision", () => {
    expect(shouldAcceptServerRevision(5, 4)).toBe(false);
    expect(shouldAcceptServerRevision(5, 5)).toBe(false);
    expect(shouldAcceptServerRevision(5, 6)).toBe(true);
    expect(shouldAcceptServerRevision(undefined, undefined)).toBe(true);
  });
});
