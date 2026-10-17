/**
 * Every way a session ends clears the
 * account's caches and session stores, so the next account on the device
 * sees no old data and no "Retry" of old failed comments.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const qc = vi.hoisted(() => ({ client: null as null | import("@tanstack/react-query").QueryClient }));
vi.mock("./query-client", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  qc.client = new QueryClient();
  return { queryClient: qc.client };
});
const route = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock("@/lib/route-restore", () => ({ forgetRememberedRoute: route.forget }));

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
vi.mock("./workspace-store", () => ({
  useWorkspaceStore: { getState: () => ({ restoreSlug: async () => {} }) },
}));
vi.mock("@/lib/notify/session", () => ({ handOverSession: vi.fn() }));
vi.mock("@/lib/filter-storage", () => ({ clearAllFilterStorage: vi.fn(async () => {}) }));
// Filters have their own test (auth-logout-filters.test.ts).
vi.mock("./stores/inbox-filter-store", () => ({
  useInboxFilterStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("./stores/issue-list-filter-store", () => ({
  useIssueListFilterStore: { getState: () => ({ reset: vi.fn() }) },
}));

import { useAuthStore } from "./auth-store";
import { useFailedCommentsStore } from "./stores/failed-comments-store";
import { useLastViewedStore } from "./stores/last-viewed-store";
import { useViewedIssuesStore } from "./viewed-issues-store";

/** What the old account leaves behind while signed in. */
function seedOldAccount() {
  const client = qc.client!;
  client.setQueryData(["issues", "ws-old"], [{ id: "i-1", title: "Old secret issue" }]);
  client.getMutationCache().build(client, { mutationKey: ["comment"] });
  useFailedCommentsStore.getState().markFailed("optimistic-1", {
    issueId: "i-1",
    entry: { id: "optimistic-1" } as never,
    content: "text of the old account",
    error: "network",
  });
  useLastViewedStore.getState().markViewed("i-1");
  useViewedIssuesStore.getState().push("ws-old", "i-1");
  route.forget.mockClear();
}

function expectNothingLeft() {
  const client = qc.client!;
  expect(client.getQueryCache().getAll()).toEqual([]);
  expect(client.getMutationCache().getAll()).toEqual([]);
  expect(useFailedCommentsStore.getState().failed).toEqual({});
  expect(useLastViewedStore.getState().lastViewed).toEqual({});
  expect(useViewedIssuesStore.getState().byWorkspace).toEqual({});
  expect(route.forget).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  seedOldAccount();
});

describe("session end clears the old account's data", () => {
  // Settings → Sign out, the workspace selection, a 401 while the app runs
  // (_layout onUnauthorized) and the server setup (other server, "Forget
  // server") all end the session through logout().
  it("logout() clears caches, failed comments, viewed markers and the saved route", async () => {
    await useAuthStore.getState().logout();
    expectNothingLeft();
  });

  it("401 on the launch check (no logout) clears them too", async () => {
    getToken.mockResolvedValueOnce("tok");
    getMe.mockRejectedValueOnce(new ApiError(401));
    await useAuthStore.getState().initialize();
    expectNothingLeft();
  });

  it("a network error on the launch check keeps the session's data", async () => {
    getToken.mockResolvedValueOnce("tok");
    getMe.mockRejectedValueOnce(new ApiError(503));
    await useAuthStore.getState().initialize();
    expect(qc.client!.getQueryCache().getAll()).toHaveLength(1);
    expect(route.forget).not.toHaveBeenCalled();
  });
});

describe("every sign-out path goes through logout()", () => {
  // The screens are React Native components; the guard reads their source,
  // so a path that clears only part of the session (as Settings and the
  // workspace selection did before S-1) shows up here.
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it.each([
    ["Settings → Sign out", "app/(app)/[workspace]/more/settings.tsx"],
    ["workspace selection", "app/(app)/select-workspace.tsx"],
    ["401 while running (onUnauthorized)", "app/_layout.tsx"],
    ["server setup: other server / Forget server", "app/(auth)/server-setup.tsx"],
  ])("%s calls logout()", (_name, file) => {
    expect(read(file)).toMatch(/\blogout\(\)/);
  });
});
