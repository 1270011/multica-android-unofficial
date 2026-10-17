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

import {
  isIssueFilterList,
  issueListFilterStorageKey,
  useIssueListFilterStore,
} from "./issue-list-filter-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const get = (key: string) => useIssueListFilterStore.getState().filters[key];

describe("issue list filter store", () => {
  beforeEach(() => {
    storage.clear();
    useIssueListFilterStore.setState({ filters: {}, hydrated: {} });
  });

  it("keeps filters per list and per workspace", () => {
    const store = useIssueListFilterStore.getState();
    store.toggle("all", "ws-a", "labels", "bug");
    store.toggle("my", "ws-a", "due", "overdue");
    store.toggle("all", "ws-b", "statuses", "todo");
    expect(get("all:ws-a")?.labels).toEqual(["bug"]);
    expect(get("all:ws-a")?.due).toEqual([]);
    expect(get("my:ws-a")?.due).toEqual(["overdue"]);
    expect(get("all:ws-b")?.statuses).toEqual(["todo"]);
    expect(get("project:ws-a")).toBeUndefined();
  });

  it("remembers filters across a restart and forgets them after clear", async () => {
    const store = useIssueListFilterStore.getState();
    store.toggle("project", "ws-a", "labels", "bug");
    store.toggleNoProject("all", "ws-a");
    await flush();

    useIssueListFilterStore.setState({ filters: {}, hydrated: {} });
    await useIssueListFilterStore.getState().hydrate("project", "ws-a");
    await useIssueListFilterStore.getState().hydrate("all", "ws-a");
    expect(get("project:ws-a")?.labels).toEqual(["bug"]);
    expect(get("all:ws-a")?.includeNoProject).toBe(true);

    useIssueListFilterStore.getState().clear("project", "ws-a");
    await flush();
    expect(storage.has(issueListFilterStorageKey("project", "ws-a"))).toBe(false);
    expect(storage.has(issueListFilterStorageKey("all", "ws-a"))).toBe(true);
  });

  it("does not let a late hydration overwrite a newer toggle", async () => {
    storage.set(issueListFilterStorageKey("my", "ws-a"), JSON.stringify({ labels: ["old"] }));
    const pending = useIssueListFilterStore.getState().hydrate("my", "ws-a");
    useIssueListFilterStore.getState().toggle("my", "ws-a", "labels", "new");
    await pending;
    expect(get("my:ws-a")?.labels).toEqual(["new"]);
  });

  it("validates the scope param and builds SecureStore-safe keys", () => {
    expect(isIssueFilterList("project")).toBe(true);
    expect(isIssueFilterList("other")).toBe(false);
    expect(issueListFilterStorageKey("my", "a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
