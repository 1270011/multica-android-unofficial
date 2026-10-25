import { describe, expect, it } from "vitest";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import {
  suppressIdsForSubmit,
  toggleSuppressed,
  triggerChips,
  triggerReasonSource,
} from "./comment-trigger-chips";

const walt: CommentTriggerPreviewAgent = { id: "a1", name: "Walt", source: "issue_assignee", reason: "" };
const bob: CommentTriggerPreviewAgent = { id: "a2", name: "Bob", source: "thread_parent", reason: "" };

describe("comment trigger chips (W1-P3b)", () => {
  it("renders nothing for an empty preview (nobody, loading, error, offline)", () => {
    expect(triggerChips([], [])).toEqual([]);
    expect(triggerChips([], ["a1"])).toEqual([]);
  });

  it("keeps server order, one chip per agent, and marks deselected ones", () => {
    const dup = { ...walt, source: "mention_agent" };
    expect(triggerChips([walt, bob, dup], ["a2"])).toEqual([
      { agent: walt, suppressed: false },
      { agent: bob, suppressed: true },
    ]);
  });

  it("maps known sources to a reason and ignores unknown ones", () => {
    expect(triggerReasonSource("issue_assignee")).toBe("issue_assignee");
    expect(triggerReasonSource("conversation_continuation")).toBe("conversation_continuation");
    expect(triggerReasonSource("something_new")).toBeNull();
  });

  it("toggles a chip off and on again", () => {
    const off = toggleSuppressed([], "a1");
    expect(off).toEqual(["a1"]);
    expect(toggleSuppressed(off, "a1")).toEqual([]);
  });

  it("sends only deselected agents the row still shows", () => {
    expect(suppressIdsForSubmit([], [walt, bob])).toBeUndefined();
    expect(suppressIdsForSubmit(["a2"], [walt, bob])).toEqual(["a2"]);
    // Bob dropped out of the preview: his old deselection is not sent.
    expect(suppressIdsForSubmit(["a2"], [walt])).toBeUndefined();
    expect(suppressIdsForSubmit(["a1", "a2"], [walt])).toEqual(["a1"]);
  });
});
