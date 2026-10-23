// @vitest-environment node
/** The in-memory Markdown split cache holds comment texts of the
 *  active workspace; a workspace switch or leaving it drops them. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("./stores/drafts", () => ({ clearAllDrafts: vi.fn() }));

import { useWorkspaceStore } from "./workspace-store";
import {
  clearMarkdownSegmentCache,
  getMarkdownSegments,
  markdownSegmentCacheStats,
} from "@/lib/markdown/segment-cache";

beforeEach(async () => {
  await useWorkspaceStore.getState().setCurrentWorkspace("ws-a", "a");
  clearMarkdownSegmentCache();
  getMarkdownSegments("Kommentar aus Workspace A");
});

describe("workspace store clears the Markdown split cache", () => {
  it("on a switch to another workspace", async () => {
    await useWorkspaceStore.getState().setCurrentWorkspace("ws-b", "b");
    expect(markdownSegmentCacheStats().entries).toBe(0);
  });

  it("not when re-entering the same workspace", async () => {
    await useWorkspaceStore.getState().setCurrentWorkspace("ws-a", "a");
    expect(markdownSegmentCacheStats().entries).toBe(1);
  });

  it("when leaving the workspace context", async () => {
    await useWorkspaceStore.getState().clear();
    expect(markdownSegmentCacheStats().entries).toBe(0);
  });
});
