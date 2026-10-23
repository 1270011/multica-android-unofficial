// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolveMe: (_: unknown) => {},
  resolveToken: null as null | ((t: string) => void),
  /** Set → setToken() waits until it is called (verifyCode test). */
  releaseSetToken: null as null | (() => void),
  holdSetToken: false,
}));

vi.mock("./api", () => ({
  ApiError: class extends Error {},
  api: {
    setToken: vi.fn(),
    getMe: vi.fn(() => new Promise((r) => (state.resolveMe = r))),
    verifyCode: vi.fn(async () => ({ token: "new-tok", user: { id: "u-2", name: "Bo" } })),
  },
}));
vi.mock("./secure-storage", () => ({
  getToken: vi.fn(() =>
    state.resolveToken === null ? Promise.resolve("tok") : new Promise<string>((r) => (state.resolveToken = r)),
  ),
  clearToken: vi.fn(async () => {}),
  setToken: vi.fn(() =>
    state.holdSetToken ? new Promise<void>((r) => (state.releaseSetToken = r)) : Promise.resolve(),
  ),
}));
vi.mock("./workspace-store", () => ({
  useWorkspaceStore: { getState: () => ({ restoreSlug: async () => {} }) },
}));
vi.mock("@/lib/notify/session", () => ({ handOverSession: vi.fn() }));
// Session data has its own test (session-end.test.ts); its real
// module loads the React Native query client.
vi.mock("./session-end", () => ({ clearSessionData: vi.fn() }));
// Filter stores are reset on logout; they are not under test here.
vi.mock("./stores/inbox-filter-store", () => ({
  useInboxFilterStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("./stores/issue-list-filter-store", () => ({
  useIssueListFilterStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("./stores/my-issues-view-store", () => ({
  useMyIssuesViewStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("./stores/active-issue-view-store", () => ({
  useActiveIssueViewStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("@/lib/filter-storage", () => ({ clearAllFilterStorage: vi.fn(async () => {}) }));

import { handOverSession } from "@/lib/notify/session";
import { api } from "./api";
import { useAuthStore } from "./auth-store";

describe("auth-store initialize vs logout", () => {
  it("a logout during getMe() wins: no user, no session handover, not stuck loading", async () => {
    const init = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(state.resolveMe).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 0));
    await useAuthStore.getState().logout();
    state.resolveMe({ id: "u-1", name: "Ana" });
    await init;

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(handOverSession).not.toHaveBeenCalled();
  });

  it("a logout while the token is still being read wins too", async () => {
    vi.mocked(handOverSession).mockClear();
    vi.mocked(api.getMe).mockClear();
    state.resolveToken = () => {}; // getToken() now waits
    const init = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(typeof state.resolveToken).toBe("function"));
    await new Promise((r) => setTimeout(r, 0));
    await useAuthStore.getState().logout();
    state.resolveToken!("tok");
    await init;

    expect(api.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(handOverSession).not.toHaveBeenCalled();
  });
});

describe("verifyCode vs logout", () => {
  it("a logout while the new token is written wins: no user, no session handover", async () => {
    vi.mocked(handOverSession).mockClear();
    vi.mocked(api.setToken).mockClear();
    state.holdSetToken = true;
    const verify = useAuthStore.getState().verifyCode("bo@example.com", "123456");
    await vi.waitFor(() => expect(state.releaseSetToken).not.toBe(null));
    await useAuthStore.getState().logout();
    state.releaseSetToken!();
    await verify;
    state.holdSetToken = false;

    expect(useAuthStore.getState().user).toBeNull();
    expect(handOverSession).not.toHaveBeenCalled();
    expect(api.setToken).not.toHaveBeenCalledWith("new-tok");
  });

  it("without a logout the session is handed over", async () => {
    vi.mocked(handOverSession).mockClear();
    await useAuthStore.getState().verifyCode("bo@example.com", "123456");
    expect(useAuthStore.getState().user).toEqual({ id: "u-2", name: "Bo" });
    expect(handOverSession).toHaveBeenCalledWith("new-tok");
  });
});
