import { describe, expect, it } from "vitest";
import { useMentionDraftStore } from "@/data/stores/mention-draft-store";

describe("mention draft store", () => {
  it("counts sheet closes and keeps the picks (F1)", () => {
    const s = useMentionDraftStore.getState();
    s.toggle({ type: "member", id: "u1", name: "ops-bot" });
    const before = useMentionDraftStore.getState().pickerCloses;
    s.markPickerClosed();
    const after = useMentionDraftStore.getState();
    expect(after.pickerCloses).toBe(before + 1);
    expect(after.mentions).toHaveLength(1);
    s.clear();
    expect(useMentionDraftStore.getState().pickerCloses).toBe(before + 1);
  });
});
