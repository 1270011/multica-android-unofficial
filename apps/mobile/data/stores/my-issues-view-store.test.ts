import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
/** Reads of these keys wait until the promise resolves. */
const gates = new Map<string, Promise<void>>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => {
    await gates.get(key);
    return storage.get(key) ?? null;
  }),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));

import {
  myIssuesScopeStorageKey,
  parseStoredMyIssuesScope,
  useMyIssuesViewStore,
} from "./my-issues-view-store";
import {
  issueListFilterStorageKey,
  useIssueListFilterStore,
} from "./issue-list-filter-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const scopeOf = (wsId: string) => useMyIssuesViewStore.getState().scopes[wsId];
const myFilters = (wsId: string) =>
  useIssueListFilterStore.getState().filters[`my:${wsId}`];

describe("parseStoredMyIssuesScope", () => {
  it("migrates the old agents tab to All", () => {
    expect(parseStoredMyIssuesScope("agents")).toEqual({
      scope: "all",
      migratedFromAgents: true,
    });
  });

  it("keeps valid tabs and falls back to Assigned", () => {
    expect(parseStoredMyIssuesScope("created").scope).toBe("created");
    expect(parseStoredMyIssuesScope("all").scope).toBe("all");
    expect(parseStoredMyIssuesScope(null).scope).toBe("assigned");
    expect(parseStoredMyIssuesScope("members").scope).toBe("assigned");
    expect(parseStoredMyIssuesScope("all").migratedFromAgents).toBe(false);
  });
});

describe("my issues view store", () => {
  beforeEach(() => {
    storage.clear();
    useMyIssuesViewStore.setState({ scopes: {}, hydrated: {} });
    useIssueListFilterStore.setState({ filters: {}, hydrated: {} });
  });

  it("remembers the tab per workspace across a restart", async () => {
    useMyIssuesViewStore.getState().setScope("ws-a", "all");
    useMyIssuesViewStore.getState().setScope("ws-b", "created");
    await flush();

    useMyIssuesViewStore.setState({ scopes: {}, hydrated: {} });
    await useMyIssuesViewStore.getState().hydrate("ws-a");
    await useMyIssuesViewStore.getState().hydrate("ws-b");
    await useMyIssuesViewStore.getState().hydrate("ws-c");
    expect(scopeOf("ws-a")).toBe("all");
    expect(scopeOf("ws-b")).toBe("created");
    expect(scopeOf("ws-c")).toBe("assigned");
  });

  it("does not store the default tab", async () => {
    useMyIssuesViewStore.getState().setScope("ws-a", "all");
    await flush();
    useMyIssuesViewStore.getState().setScope("ws-a", "assigned");
    await flush();
    expect(storage.has(myIssuesScopeStorageKey("ws-a"))).toBe(false);
  });

  it("turns a stored agents tab into All plus 'My agents and squads'", async () => {
    storage.set(myIssuesScopeStorageKey("ws-a"), "agents");
    storage.set(
      issueListFilterStorageKey("my", "ws-a"),
      JSON.stringify({ priorities: ["high"] }),
    );

    await useMyIssuesViewStore.getState().hydrate("ws-a");
    await flush();

    expect(scopeOf("ws-a")).toBe("all");
    expect(myFilters("ws-a")?.involvesMe).toBe(true);
    // Existing filters of the list stay.
    expect(myFilters("ws-a")?.priorities).toEqual(["high"]);
    // Migration is written back, so it runs once.
    expect(storage.get(myIssuesScopeStorageKey("ws-a"))).toBe("all");
    expect(
      JSON.parse(storage.get(issueListFilterStorageKey("my", "ws-a")) ?? "{}").involvesMe,
    ).toBe(true);
  });

  it("does not let a late hydration overwrite a newer tab choice", async () => {
    storage.set(myIssuesScopeStorageKey("ws-a"), "created");
    const pending = useMyIssuesViewStore.getState().hydrate("ws-a");
    useMyIssuesViewStore.getState().setScope("ws-a", "all");
    await pending;
    expect(scopeOf("ws-a")).toBe("all");
  });

  it("forgets tabs on reset (logout)", () => {
    useMyIssuesViewStore.getState().setScope("ws-a", "all");
    useMyIssuesViewStore.getState().reset();
    expect(scopeOf("ws-a")).toBeUndefined();
  });
});

describe("my issues view store logout race", () => {
  beforeEach(() => {
    storage.clear();
    gates.clear();
    useMyIssuesViewStore.getState().reset();
    useIssueListFilterStore.getState().reset();
  });

  it("drops a hydrate that finishes after reset", async () => {
    storage.set(myIssuesScopeStorageKey("ws-a"), "created");
    const pending = useMyIssuesViewStore.getState().hydrate("ws-a");
    useMyIssuesViewStore.getState().reset();
    await pending;
    expect(scopeOf("ws-a")).toBeUndefined();
    expect(useMyIssuesViewStore.getState().hydrated["ws-a"]).toBeUndefined();
  });

  it("does not migrate the old agents tab into the next account", async () => {
    storage.set(myIssuesScopeStorageKey("ws-a"), "agents");
    const pending = useMyIssuesViewStore.getState().hydrate("ws-a");
    useMyIssuesViewStore.getState().reset();
    await pending;
    await flush();
    expect(scopeOf("ws-a")).toBeUndefined();
    expect(myFilters("ws-a")).toBeUndefined();
    expect(storage.get(myIssuesScopeStorageKey("ws-a"))).toBe("agents");
  });

  it("does not migrate when logout happens during the filter read", async () => {
    storage.set(myIssuesScopeStorageKey("ws-a"), "agents");
    let release = () => {};
    gates.set(
      issueListFilterStorageKey("my", "ws-a"),
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = useMyIssuesViewStore.getState().hydrate("ws-a");
    // Wait until the scope read is done and the filter read is pending.
    await vi.waitFor(() => expect(scopeOf("ws-a")).toBe("all"));
    useMyIssuesViewStore.getState().reset();
    release();
    await pending;
    await flush();
    expect(myFilters("ws-a")?.involvesMe).toBeUndefined();
    expect(storage.get(myIssuesScopeStorageKey("ws-a"))).toBe("agents");
  });
});
