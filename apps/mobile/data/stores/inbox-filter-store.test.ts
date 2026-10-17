import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { inboxFilterStorageKey, useInboxFilterStore } from "./inbox-filter-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("inbox filter store", () => {
  beforeEach(() => {
    storage.clear();
    useInboxFilterStore.setState({ filtersByWorkspace: {}, hydrated: {} });
  });

  it("keeps filters per workspace", () => {
    const store = useInboxFilterStore.getState();
    store.toggle("ws-a", "statuses", "todo");
    store.toggle("ws-b", "actors", "system");
    const state = useInboxFilterStore.getState().filtersByWorkspace;
    expect(state["ws-a"]?.statuses).toEqual(["todo"]);
    expect(state["ws-a"]?.actors).toEqual([]);
    expect(state["ws-b"]?.actors).toEqual(["system"]);
  });

  it("remembers filters across a restart and forgets them after clear", async () => {
    useInboxFilterStore.getState().toggle("ws-a", "priorities", "high");
    await flush();
    expect(storage.get(inboxFilterStorageKey("ws-a"))).toContain("high");

    // Simulated cold start: memory gone, storage kept.
    useInboxFilterStore.setState({ filtersByWorkspace: {}, hydrated: {} });
    await useInboxFilterStore.getState().hydrate("ws-a");
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-a"]?.priorities).toEqual(["high"]);

    useInboxFilterStore.getState().clear("ws-a");
    await flush();
    expect(storage.has(inboxFilterStorageKey("ws-a"))).toBe(false);
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-a"]).toBeUndefined();
  });

  it("does not let a late hydration overwrite a newer toggle", async () => {
    storage.set(inboxFilterStorageKey("ws-a"), JSON.stringify({ statuses: ["done"] }));
    const pending = useInboxFilterStore.getState().hydrate("ws-a");
    useInboxFilterStore.getState().toggle("ws-a", "statuses", "todo");
    await pending;
    expect(useInboxFilterStore.getState().filtersByWorkspace["ws-a"]?.statuses).toEqual(["todo"]);
  });

  it("builds SecureStore-safe keys", () => {
    expect(inboxFilterStorageKey("3f22d6b5-1229-4d97")).toBe("rb.inbox_filters.3f22d6b5-1229-4d97");
    expect(inboxFilterStorageKey("a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
