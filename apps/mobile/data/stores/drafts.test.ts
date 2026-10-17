// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("@/lib/notify/session", () => ({ clearNotifySession: vi.fn() }));

import { useChatDraftsStore } from "./chat-drafts-store";
import { useCommentDraftsStore } from "./comment-drafts-store";
import { clearAllDrafts } from "./drafts";
import { clearToken } from "../secure-storage";
import { useWorkspaceStore } from "../workspace-store";

function typeDrafts() {
  useChatDraftsStore.getState().setDraft("session-1", "chat text");
  useCommentDraftsStore.getState().setText("issue-1", "comment text");
}
const chatDrafts = () => useChatDraftsStore.getState().drafts;
const commentDrafts = () => useCommentDraftsStore.getState().drafts;

describe("drafts never outlive the session or workspace", () => {
  beforeEach(() => {
    clearAllDrafts();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a", currentWorkspaceSlug: "a" });
  });

  it("clearAllDrafts drops chat and comment drafts", () => {
    typeDrafts();
    clearAllDrafts();
    expect(chatDrafts()).toEqual({});
    expect(commentDrafts()).toEqual({});
  });

  it("every session end (clearToken: logout, 401) drops them", async () => {
    typeDrafts();
    await clearToken();
    expect(chatDrafts()).toEqual({});
    expect(commentDrafts()).toEqual({});
  });

  it("switching to another workspace drops them", async () => {
    typeDrafts();
    await useWorkspaceStore.getState().setCurrentWorkspace("ws-b", "b");
    expect(chatDrafts()).toEqual({});
    expect(commentDrafts()).toEqual({});
  });

  it("re-entering the same workspace keeps them", async () => {
    typeDrafts();
    await useWorkspaceStore.getState().setCurrentWorkspace("ws-a", "a");
    expect(chatDrafts()).toEqual({ "session-1": "chat text" });
    expect(commentDrafts()).toEqual({ "issue-1": { text: "comment text" } });
  });

  it("leaving the workspace context drops them", async () => {
    typeDrafts();
    await useWorkspaceStore.getState().clear();
    expect(chatDrafts()).toEqual({});
    expect(commentDrafts()).toEqual({});
  });
});
