// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => JSON.stringify({ all: "board" })),
  setItemAsync: vi.fn(async () => {}),
}));

import * as SecureStore from "expo-secure-store";
import { parseViewModes, useIssueViewModeStore } from "./issue-view-mode-store";

describe("parseViewModes", () => {
  it("keeps known lists with list/board, drops the rest", () => {
    expect(parseViewModes('{"all":"board","my":"list","project":"grid","x":"board"}')).toEqual({
      all: "board",
      my: "list",
    });
    expect(parseViewModes("not json")).toEqual({});
    expect(parseViewModes(null)).toEqual({});
  });
});

describe("useIssueViewModeStore", () => {
  it("loads the stored choice and persists changes per list", async () => {
    await vi.waitFor(() => expect(useIssueViewModeStore.getState().modes.all).toBe("board"));
    useIssueViewModeStore.getState().setMode("my", "board");
    expect(useIssueViewModeStore.getState().modes).toEqual({ all: "board", my: "board" });
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
      "issue-view-modes",
      JSON.stringify({ all: "board", my: "board" }),
    );
  });
});
