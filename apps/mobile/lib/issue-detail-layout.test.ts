// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DETAIL_PANE,
  INITIAL_DETAIL_PANE_STATE,
  leftPaneWidth,
  selectDetailPane,
} from "./issue-detail-layout";

describe("issue detail panes", () => {
  it("chat is the default right pane", () => {
    expect(DEFAULT_DETAIL_PANE).toBe("chat");
    expect(INITIAL_DETAIL_PANE_STATE.pane).toBe("chat");
  });
  it("left pane takes ~42 %, at least 360 dp", () => {
    expect(leftPaneWidth(1280)).toBe(538);
    expect(leftPaneWidth(840)).toBe(360);
  });
});

describe("selectDetailPane (T5 in the embedded chat)", () => {
  it("opening the detail marks nothing read, although the chat shows", () => {
    expect(INITIAL_DETAIL_PANE_STATE.chatReadAllowed).toBe(false);
  });
  it("switching to Activity does not allow reading", () => {
    const s = selectDetailPane(INITIAL_DETAIL_PANE_STATE, "activity");
    expect(s).toEqual({ pane: "activity", chatReadAllowed: false });
  });
  it("an explicit tap on Chat allows reading, also when Chat already shows", () => {
    expect(selectDetailPane(INITIAL_DETAIL_PANE_STATE, "chat").chatReadAllowed).toBe(true);
    const back = selectDetailPane(selectDetailPane(INITIAL_DETAIL_PANE_STATE, "activity"), "chat");
    expect(back).toEqual({ pane: "chat", chatReadAllowed: true });
  });
  it("the permission stays for this detail after switching away again", () => {
    const s = selectDetailPane(selectDetailPane(INITIAL_DETAIL_PANE_STATE, "chat"), "activity");
    expect(s).toEqual({ pane: "activity", chatReadAllowed: true });
  });
  it("returns the same object when nothing changes", () => {
    const s = selectDetailPane(INITIAL_DETAIL_PANE_STATE, "chat");
    expect(selectDetailPane(s, "chat")).toBe(s);
  });
});
