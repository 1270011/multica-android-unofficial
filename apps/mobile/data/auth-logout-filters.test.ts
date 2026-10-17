import { describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));
const { getMe, getToken, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public status: number) {
      super(`HTTP ${status}`);
    }
  }
  return { getMe: vi.fn(), getToken: vi.fn(async () => null as string | null), ApiError };
});
vi.mock("./api", () => ({ api: { setToken: vi.fn(), getMe }, ApiError }));
vi.mock("./secure-storage", () => ({
  clearToken: vi.fn(async () => {}),
  getToken,
  setToken: vi.fn(async () => {}),
}));
// Real epoch reads (initialize checks them since #14), only the bump is spied.
vi.mock("./session-epoch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-epoch")>()),
  invalidateSessionEpoch: vi.fn(),
}));
vi.mock("./workspace-store", () => ({
  useWorkspaceStore: { getState: () => ({ restoreSlug: async () => {} }) },
}));
// Session data (S-1) has its own test (session-end.test.ts); its real
// module loads the React Native query client.
vi.mock("./session-end", () => ({ clearSessionData: vi.fn() }));

import { useAuthStore } from "./auth-store";
import { useInboxFilterStore } from "./stores/inbox-filter-store";
import { useIssueListFilterStore } from "./stores/issue-list-filter-store";

// review #21: the next user on the device must not inherit filters.
describe("logout forgets remembered filters", () => {
  it("clears memory and SecureStore of inbox and list filters", async () => {
    useInboxFilterStore.getState().toggle("ws-a", "actors", "system");
    useIssueListFilterStore.getState().toggle("my", "ws-b", "labels", "bug");
    await new Promise((r) => setTimeout(r, 0));
    expect([...storage.keys()].some((k) => k.startsWith("rb.inbox_filters."))).toBe(true);

    await useAuthStore.getState().logout();

    expect(useInboxFilterStore.getState().filtersByWorkspace).toEqual({});
    expect(useIssueListFilterStore.getState().filters).toEqual({});
    expect([...storage.keys()]).toEqual([]);

    // A new session re-reads storage and finds nothing.
    await useIssueListFilterStore.getState().hydrate("my", "ws-b");
    expect(useIssueListFilterStore.getState().filters["my:ws-b"]).toBeUndefined();
  });
});

// Review #22: a session that ends with a 401 on the launch check (no logout)
// must not hand its filters to the next sign-in; a network/5xx error keeps them.
describe("launch check forgets filters only on 401", () => {
  async function seed() {
    useIssueListFilterStore.getState().toggle("all", "ws-a", "due", "overdue");
    await new Promise((r) => setTimeout(r, 0));
  }

  it("401: memory and storage are cleared", async () => {
    await seed();
    getToken.mockResolvedValueOnce("tok");
    getMe.mockRejectedValueOnce(new ApiError(401));
    await useAuthStore.getState().initialize();
    expect(useIssueListFilterStore.getState().filters).toEqual({});
    expect([...storage.keys()]).toEqual([]);
  });

  it("5xx: filters stay", async () => {
    await seed();
    getToken.mockResolvedValueOnce("tok");
    getMe.mockRejectedValueOnce(new ApiError(503));
    await useAuthStore.getState().initialize();
    expect(useIssueListFilterStore.getState().filters["all:ws-a"]?.due).toEqual(["overdue"]);
    expect([...storage.keys()].some((k) => k.startsWith("rb.issue_filters."))).toBe(true);
  });
});
