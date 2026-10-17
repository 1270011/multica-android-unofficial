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
  clearAllFilterStorage,
  FILTER_INDEX_KEY,
  saveFilter,
} from "./filter-storage";

describe("filter storage", () => {
  beforeEach(() => storage.clear());

  it("records every written key once, also under concurrent writes", async () => {
    await Promise.all([
      saveFilter("rb.inbox_filters.ws-a", "{}"),
      saveFilter("rb.issue_filters.my.ws-a", "{}"),
      saveFilter("rb.inbox_filters.ws-a", "{\"x\":1}"),
    ]);
    expect(JSON.parse(storage.get(FILTER_INDEX_KEY)!)).toEqual([
      "rb.inbox_filters.ws-a",
      "rb.issue_filters.my.ws-a",
    ]);
  });

  it("deletes a key when the value is null", async () => {
    await saveFilter("rb.inbox_filters.ws-a", "{}");
    await saveFilter("rb.inbox_filters.ws-a", null);
    expect(storage.has("rb.inbox_filters.ws-a")).toBe(false);
  });

  it("logout clear removes every stored filter, also of other workspaces, and keeps unrelated keys", async () => {
    storage.set("rb.clipboard_clear_after_paste", "1");
    await saveFilter("rb.inbox_filters.ws-a", "{}");
    await saveFilter("rb.issue_filters.project.ws-b", "{}");
    await clearAllFilterStorage();
    expect([...storage.keys()]).toEqual(["rb.clipboard_clear_after_paste"]);
  });

  it("a clear queued after a write runs after it", async () => {
    const write = saveFilter("rb.inbox_filters.ws-a", "{}");
    const clear = clearAllFilterStorage();
    await Promise.all([write, clear]);
    expect(storage.has("rb.inbox_filters.ws-a")).toBe(false);
  });
});
