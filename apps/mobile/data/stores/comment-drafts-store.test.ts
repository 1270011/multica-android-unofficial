// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useCommentDraftsStore } from "./comment-drafts-store";

const store = () => useCommentDraftsStore.getState();

describe("useCommentDraftsStore", () => {
  beforeEach(() => useCommentDraftsStore.setState({ drafts: {} }));

  it("keeps the text per issue across composer remounts", () => {
    store().setText("a", "half a comment");
    store().setText("b", "other");
    expect(store().drafts.a).toEqual({ text: "half a comment" });
    expect(store().drafts.b?.text).toBe("other");
  });
  it("an empty new comment removes the draft", () => {
    store().setText("a", "x");
    store().setText("a", "");
    expect(store().drafts).toEqual({});
  });
  it("an edit keeps its target while the text changes, also when emptied", () => {
    store().startEdit("a", "c1", "original");
    store().setText("a", "changed");
    expect(store().drafts.a).toEqual({ text: "changed", editId: "c1" });
    store().setText("a", "");
    expect(store().drafts.a).toEqual({ text: "", editId: "c1" });
  });
  it("starting an edit replaces a new-comment draft", () => {
    store().setText("a", "new");
    store().startEdit("a", "c1", "original");
    expect(store().drafts.a).toEqual({ text: "original", editId: "c1" });
  });
  it("clear drops only that issue and skips unknown ids", () => {
    store().setText("a", "x");
    store().setText("b", "y");
    const before = store().drafts;
    store().clear("zzz");
    expect(store().drafts).toBe(before);
    store().clear("a");
    expect(store().drafts).toEqual({ b: { text: "y" } });
  });
  it("same text is a no-op", () => {
    store().setText("a", "x");
    const before = store().drafts;
    store().setText("a", "x");
    expect(store().drafts).toBe(before);
  });
});

describe("comment draft attachments (J3b)", () => {
  beforeEach(() => useCommentDraftsStore.setState({ drafts: {} }));
  const file = (localId: string, status = "uploading") => ({ localId, status }) as never;

  it("keeps picked files without text across remounts", () => {
    store().updateAttachments("a", () => [file("f1")]);
    expect(store().drafts.a?.attachments).toHaveLength(1);
    // Emptying the text keeps the draft while files are attached.
    store().setText("a", "x");
    store().setText("a", "");
    expect(store().drafts.a?.attachments).toHaveLength(1);
  });
  it("an upload finishing after a remount updates the stored list", () => {
    store().updateAttachments("a", () => [file("f1"), file("f2")]);
    // The old composer's callback marks f1 done on whatever is stored now.
    store().updateAttachments("a", (prev) =>
      prev.map((it) => ((it as { localId: string }).localId === "f1" ? ({ localId: "f1", status: "done" } as never) : it)),
    );
    expect(store().drafts.a?.attachments).toEqual([
      { localId: "f1", status: "done" },
      { localId: "f2", status: "uploading" },
    ]);
  });
  it("removing the last file of an empty draft drops it", () => {
    store().updateAttachments("a", () => [file("f1")]);
    store().updateAttachments("a", () => []);
    expect(store().drafts).toEqual({});
  });
  it("an unchanged list is a no-op", () => {
    store().updateAttachments("a", () => [file("f1")]);
    const before = store().drafts;
    store().updateAttachments("a", (prev) => prev);
    expect(store().drafts).toBe(before);
  });
});
