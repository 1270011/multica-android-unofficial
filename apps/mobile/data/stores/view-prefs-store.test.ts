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

import { useViewPrefsStore } from "./view-prefs-store";
import { clearAllFilterStorage } from "@/lib/filter-storage";
import {
  DEFAULT_TITLE_FILTER,
  hiddenActorsStorageKey,
  MENTION_SORT_STORAGE_KEY,
  titleFilterStorageKey,
} from "@/lib/view-prefs";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Cold start: memory gone, storage kept. */
function restart() {
  useViewPrefsStore.setState({
    hiddenByWorkspace: {},
    titleFilterByWorkspace: {},
    hydrated: {},
    mentionSort: "frequency",
    mentionSortHydrated: false,
  });
}

describe("view prefs store", () => {
  beforeEach(() => {
    storage.clear();
    restart();
  });

  it("keeps hidden actors and title filter per workspace (workspace switch)", async () => {
    const s = useViewPrefsStore.getState();
    s.setActorHidden("ws-a", "agents", "a1", true);
    s.setTitleFilter("ws-a", { enabled: true });
    s.setActorHidden("ws-b", "members", "u2", true);
    await flush();

    const state = useViewPrefsStore.getState();
    expect(state.hiddenByWorkspace["ws-a"]).toEqual({ members: [], agents: ["a1"] });
    expect(state.hiddenByWorkspace["ws-b"]).toEqual({ members: ["u2"], agents: [] });
    expect(state.titleFilterByWorkspace["ws-a"]?.enabled).toBe(true);
    expect(state.titleFilterByWorkspace["ws-b"]).toBeUndefined();

    // Switching to a workspace that was never touched loads nothing foreign.
    await useViewPrefsStore.getState().hydrate("ws-c");
    expect(useViewPrefsStore.getState().hiddenByWorkspace["ws-c"]).toEqual({ members: [], agents: [] });
    expect(useViewPrefsStore.getState().titleFilterByWorkspace["ws-c"]).toEqual(DEFAULT_TITLE_FILTER);
  });

  it("remembers values across a restart", async () => {
    useViewPrefsStore.getState().setActorHidden("ws-a", "agents", "a1", true);
    useViewPrefsStore.getState().setTitleFilter("ws-a", { enabled: true, ignoreCase: true });
    useViewPrefsStore.getState().setMentionSort("name");
    await flush();
    expect(storage.get(hiddenActorsStorageKey("ws-a"))).toContain("a1");
    expect(storage.get(MENTION_SORT_STORAGE_KEY)).toBe("name");

    restart();
    await useViewPrefsStore.getState().hydrate("ws-a");
    await useViewPrefsStore.getState().hydrateDevice();
    const state = useViewPrefsStore.getState();
    expect(state.hiddenByWorkspace["ws-a"]?.agents).toEqual(["a1"]);
    expect(state.titleFilterByWorkspace["ws-a"]).toEqual({
      enabled: true,
      pattern: "^AUTO: ",
      ignoreCase: true,
      mutePush: false,
    });
    expect(state.mentionSort).toBe("name");
  });

  it("removes the stored entry when back to the default", async () => {
    const s = useViewPrefsStore.getState();
    s.setActorHidden("ws-a", "agents", "a1", true);
    s.setTitleFilter("ws-a", { enabled: true });
    await flush();
    s.showAllActors("ws-a");
    s.setTitleFilter("ws-a", { enabled: false });
    await flush();
    expect(storage.has(hiddenActorsStorageKey("ws-a"))).toBe(false);
    expect(storage.has(titleFilterStorageKey("ws-a"))).toBe(false);
  });

  it("does not wipe stored values with a no-op before hydration", async () => {
    storage.set(hiddenActorsStorageKey("ws-a"), JSON.stringify({ members: [], agents: ["a1"] }));
    useViewPrefsStore.getState().setActorHidden("ws-a", "agents", "other", false);
    await flush();
    expect(storage.get(hiddenActorsStorageKey("ws-a"))).toContain("a1");
  });

  it("does not let a late hydration overwrite a newer change", async () => {
    storage.set(titleFilterStorageKey("ws-a"), JSON.stringify({ enabled: true, pattern: "^old" }));
    const pending = useViewPrefsStore.getState().hydrate("ws-a");
    useViewPrefsStore.getState().setTitleFilter("ws-a", { pattern: "^new" });
    await pending;
    expect(useViewPrefsStore.getState().titleFilterByWorkspace["ws-a"]?.pattern).toBe("^new");
  });

  it("reset drops workspace data and a read still running, keeps the sort mode", async () => {
    useViewPrefsStore.getState().setMentionSort("name");
    storage.set(hiddenActorsStorageKey("ws-a"), JSON.stringify({ members: ["u1"], agents: [] }));
    const pending = useViewPrefsStore.getState().hydrate("ws-a");
    useViewPrefsStore.getState().reset();
    await pending;
    const state = useViewPrefsStore.getState();
    expect(state.hiddenByWorkspace).toEqual({});
    expect(state.hydrated).toEqual({});
    expect(state.mentionSort).toBe("name");
  });

  it("logout storage clear reaches every workspace but not the device sort mode", async () => {
    const s = useViewPrefsStore.getState();
    s.setActorHidden("ws-a", "agents", "a1", true);
    s.setTitleFilter("ws-b", { enabled: true });
    s.setMentionSort("name");
    await flush();
    await clearAllFilterStorage();
    expect(storage.has(hiddenActorsStorageKey("ws-a"))).toBe(false);
    expect(storage.has(titleFilterStorageKey("ws-b"))).toBe(false);
    expect(storage.get(MENTION_SORT_STORAGE_KEY)).toBe("name");
  });
});
