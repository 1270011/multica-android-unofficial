// @vitest-environment node
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
import type { IssueView } from "@multica/core/api/schemas";
import { EMPTY_ISSUE_LIST_FILTERS } from "@/lib/issue-list-filters";
import { MANUAL_SORT } from "@/lib/issue-list-sort";
import type { AppViewState } from "@/lib/issue-view-mapping";
import {
  activeIssueViewStorageKey,
  parseStoredActiveIssueView,
  serializeActiveIssueView,
  useActiveIssueViewStore,
} from "./active-issue-view-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const view = (id: string, over: Partial<IssueView> = {}): IssueView => ({
  id,
  workspace_id: "ws",
  owner_id: "me",
  name: `View ${id}`,
  scope_type: "workspace",
  scope_id: null,
  scope_variant: null,
  visibility: "private",
  definition_version: 1,
  query: {},
  display: {},
  revision: 1,
  created_at: "",
  updated_at: "",
  ...over,
});

const mine: AppViewState = {
  tab: "assigned",
  filters: { ...EMPTY_ISSUE_LIST_FILTERS, labels: ["l1"] },
  sort: MANUAL_SORT,
  viewMode: "board",
};

describe("active issue view store (D8a)", () => {
  beforeEach(() => useActiveIssueViewStore.getState().reset());

  it("applies a view and restores the own filters on exit", () => {
    const store = useActiveIssueViewStore.getState();
    const applied = store.apply("ws", view("a", { query: { statusFilters: ["todo"] } }), mine);
    expect(applied.filters.statuses).toEqual(["todo"]);
    expect(useActiveIssueViewStore.getState().active.ws).toMatchObject({
      id: "a",
      name: "View a",
      hiddenFilters: false,
      view: { id: "a", revision: 1 },
      applied: { tab: "all", filters: { statuses: ["todo"] } },
    });
    expect(store.exit("ws")).toEqual(mine);
    expect(useActiveIssueViewStore.getState().active.ws).toBeUndefined();
    expect(store.exit("ws")).toBeNull();
  });

  it("keeps the first snapshot when switching between views", () => {
    const store = useActiveIssueViewStore.getState();
    const afterA = store.apply("ws", view("a"), mine);
    store.apply("ws", view("b", { query: { propertyFilters: { d: ["x"] } } }), afterA);
    expect(useActiveIssueViewStore.getState().active.ws).toMatchObject({ id: "b", hiddenFilters: true });
    expect(store.exit("ws")).toEqual(mine);
  });

  it("forget drops the view without a snapshot to restore", () => {
    const store = useActiveIssueViewStore.getState();
    store.apply("ws", view("a"), mine);
    store.forget("ws");
    expect(useActiveIssueViewStore.getState().active.ws).toBeUndefined();
    expect(store.exit("ws")).toBeNull();
  });

  it("keeps workspaces apart", () => {
    const store = useActiveIssueViewStore.getState();
    store.apply("ws-a", view("a"), mine);
    expect(useActiveIssueViewStore.getState().active["ws-b"]).toBeUndefined();
  });

  it("update keeps the view active with the new revision and screen state (D8c)", () => {
    const store = useActiveIssueViewStore.getState();
    const applied = store.apply("ws", view("a"), mine);
    const changed = { ...applied, viewMode: "board" as const };
    store.update("ws", view("a", { name: "Neu", revision: 2 }), changed);
    expect(useActiveIssueViewStore.getState().active.ws).toMatchObject({
      name: "Neu",
      view: { revision: 2 },
      applied: { viewMode: "board" },
    });
    store.update("ws", view("a", { revision: 3 }));
    expect(useActiveIssueViewStore.getState().active.ws?.applied.viewMode).toBe("board");
    // Another view than the active one changes nothing.
    store.update("ws", view("b", { name: "B" }));
    expect(useActiveIssueViewStore.getState().active.ws?.id).toBe("a");
    expect(store.exit("ws")).toEqual(mine);
  });
});

describe("active issue view store persistence", () => {
  const key = activeIssueViewStorageKey("ws");
  const restart = () => useActiveIssueViewStore.getState().reset();

  beforeEach(() => {
    storage.clear();
    restart();
  });

  it("keeps the applied view and the own filters across a restart", async () => {
    const store = useActiveIssueViewStore.getState();
    store.apply("ws", view("a", { query: { statusFilters: ["todo"] } }), mine);
    await flush();
    expect(storage.has(key)).toBe(true);

    restart();
    expect(useActiveIssueViewStore.getState().active.ws).toBeUndefined();
    await useActiveIssueViewStore.getState().hydrate("ws");
    expect(useActiveIssueViewStore.getState().active.ws).toMatchObject({
      id: "a",
      name: "View a",
      view: { id: "a", revision: 1 },
      applied: { tab: "all", filters: { statuses: ["todo"] } },
    });
    // "Standard" still brings back the filters from before the view.
    expect(useActiveIssueViewStore.getState().exit("ws")).toEqual(mine);
  });

  it("forgets the stored view on Standard and on a tab change", async () => {
    const store = useActiveIssueViewStore.getState();
    store.apply("ws", view("a"), mine);
    store.exit("ws");
    await flush();
    expect(storage.has(key)).toBe(false);

    store.apply("ws", view("b"), mine);
    store.forget("ws");
    await flush();
    restart();
    await useActiveIssueViewStore.getState().hydrate("ws");
    expect(useActiveIssueViewStore.getState().active.ws).toBeUndefined();
  });

  it("stores the saved revision after update", async () => {
    const store = useActiveIssueViewStore.getState();
    store.apply("ws", view("a"), mine);
    store.update("ws", view("a", { name: "Renamed", revision: 3 }));
    await flush();
    restart();
    await useActiveIssueViewStore.getState().hydrate("ws");
    expect(useActiveIssueViewStore.getState().active.ws).toMatchObject({
      name: "Renamed",
      view: { revision: 3 },
    });
  });

  it("lets a view applied before the read finished win", async () => {
    storage.set(
      key,
      serializeActiveIssueView(
        {
          id: "old",
          name: "Old",
          hiddenFilters: false,
          view: view("old"),
          applied: mine,
        },
        null,
      ),
    );
    const pending = useActiveIssueViewStore.getState().hydrate("ws");
    useActiveIssueViewStore.getState().apply("ws", view("new"), mine);
    await pending;
    expect(useActiveIssueViewStore.getState().active.ws?.id).toBe("new");
  });

  it("round-trips and rejects broken entries", () => {
    const active = {
      id: "a",
      name: "A",
      hiddenFilters: true,
      view: view("a"),
      applied: mine,
    };
    expect(parseStoredActiveIssueView(serializeActiveIssueView(active, mine))).toEqual({
      active,
      previous: mine,
    });
    expect(parseStoredActiveIssueView(null)).toBeNull();
    expect(parseStoredActiveIssueView("{")).toBeNull();
    expect(parseStoredActiveIssueView(JSON.stringify({ active: { id: "a" } }))).toBeNull();
    expect(
      parseStoredActiveIssueView(
        serializeActiveIssueView({ ...active, view: view("other") }, null),
      ),
    ).toBeNull();
    expect(
      parseStoredActiveIssueView(
        JSON.stringify({ active: { ...active, applied: { ...mine, tab: "agents" } } }),
      ),
    ).toBeNull();
  });
});

describe("active issue view store logout race", () => {
  beforeEach(() => useActiveIssueViewStore.getState().reset());

  it("drops a hydrate that finishes after reset", async () => {
    const key = activeIssueViewStorageKey("ws");
    storage.set(
      key,
      serializeActiveIssueView(
        { id: "old", name: "Old", hiddenFilters: false, view: view("old"), applied: mine },
        null,
      ),
    );
    const pending = useActiveIssueViewStore.getState().hydrate("ws");
    useActiveIssueViewStore.getState().reset();
    await pending;
    const state = useActiveIssueViewStore.getState();
    expect(state.active.ws).toBeUndefined();
    expect(state.previous.ws).toBeUndefined();
    expect(state.hydrated.ws).toBeUndefined();

    // The next account reads its own storage again.
    storage.delete(key);
    await useActiveIssueViewStore.getState().hydrate("ws");
    expect(useActiveIssueViewStore.getState().active.ws).toBeUndefined();
    expect(useActiveIssueViewStore.getState().hydrated.ws).toBe(true);
  });
});
