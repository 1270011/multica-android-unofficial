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

import { EMPTY_ISSUE_LIST_FILTERS } from "@/lib/issue-list-filters";
import {
  adoptLegacyAllFilters,
  isIssueFilterList,
  issueListFilterStorageKey,
  issueListSortStorageKey,
  useIssueListFilterStore,
} from "./issue-list-filter-store";
import { MANUAL_SORT } from "@/lib/issue-list-sort";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const get = (key: string) => useIssueListFilterStore.getState().filters[key];

describe("issue list filter store", () => {
  beforeEach(() => {
    storage.clear();
    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
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

    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
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

  it("stores assignee and creator filters; 'Nobody' excludes the others (D3a)", async () => {
    const store = useIssueListFilterStore.getState();
    store.toggleAssignee("my", "ws-a", "member:u1");
    store.toggleAssigneeType("my", "ws-a", "agent");
    store.toggleCreator("my", "ws-a", "agent:a1");
    expect(get("my:ws-a")).toMatchObject({
      assignees: ["member:u1"],
      assigneeTypes: ["agent"],
      creators: ["agent:a1"],
    });
    store.setIncludeNoAssignee("my", "ws-a", true);
    expect(get("my:ws-a")).toMatchObject({
      includeNoAssignee: true,
      assignees: [],
      assigneeTypes: [],
      creators: ["agent:a1"],
    });
    await flush();

    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    expect(get("my:ws-a")).toMatchObject({ includeNoAssignee: true, creators: ["agent:a1"] });

    useIssueListFilterStore.getState().toggleAssignee("my", "ws-a", "squad:s1");
    expect(get("my:ws-a")).toMatchObject({ includeNoAssignee: false, assignees: ["squad:s1"] });
  });

  it("hydrates a value stored before D3a", async () => {
    storage.set(
      issueListFilterStorageKey("my", "ws-old"),
      JSON.stringify({ statuses: ["todo"], involvesMe: true }),
    );
    await useIssueListFilterStore.getState().hydrate("my", "ws-old");
    expect(get("my:ws-old")).toEqual({
      ...EMPTY_ISSUE_LIST_FILTERS,
      statuses: ["todo"],
      involvesMe: true,
    });
  });

  it("validates the scope param and builds SecureStore-safe keys", () => {
    expect(isIssueFilterList("project")).toBe(true);
    expect(isIssueFilterList("other")).toBe(false);
    expect(issueListFilterStorageKey("my", "a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

// The old "All issues" filters move to My Issues once.
describe("migration of the old All issues filters", () => {
  const allKey = issueListFilterStorageKey("all", "ws-a");
  const myKey = issueListFilterStorageKey("my", "ws-a");

  beforeEach(() => {
    storage.clear();
    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
  });

  it("adopts All only when My is empty", () => {
    const all = { ...EMPTY_ISSUE_LIST_FILTERS, labels: ["bug"] };
    const my = { ...EMPTY_ISSUE_LIST_FILTERS, due: ["overdue" as const] };
    expect(adoptLegacyAllFilters(EMPTY_ISSUE_LIST_FILTERS, all)).toBe(all);
    expect(adoptLegacyAllFilters(my, all)).toBe(my);
    expect(adoptLegacyAllFilters(EMPTY_ISSUE_LIST_FILTERS, EMPTY_ISSUE_LIST_FILTERS)).toBe(
      EMPTY_ISSUE_LIST_FILTERS,
    );
  });

  it("empty My: takes the All filters, stores them for My and drops All", async () => {
    storage.set(allKey, JSON.stringify({ labels: ["bug"], statuses: ["todo"] }));
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    await flush();
    expect(get("my:ws-a")?.labels).toEqual(["bug"]);
    expect(get("my:ws-a")?.statuses).toEqual(["todo"]);
    expect(storage.has(allKey)).toBe(false);
    expect(JSON.parse(storage.get(myKey) ?? "{}").labels).toEqual(["bug"]);
  });

  it("non-empty My: keeps My and still drops All", async () => {
    storage.set(myKey, JSON.stringify({ due: ["overdue"] }));
    storage.set(allKey, JSON.stringify({ labels: ["bug"] }));
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    await flush();
    expect(get("my:ws-a")?.due).toEqual(["overdue"]);
    expect(get("my:ws-a")?.labels).toEqual([]);
    expect(storage.has(allKey)).toBe(false);
  });

  it("runs once: a later cleared My stays empty", async () => {
    storage.set(allKey, JSON.stringify({ labels: ["bug"] }));
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    useIssueListFilterStore.getState().clear("my", "ws-a");
    await flush();
    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    expect(get("my:ws-a")).toBeUndefined();
  });

  it("remembers the sort per list and workspace, apart from the filters", async () => {
    const store = useIssueListFilterStore.getState();
    store.setSort("my", "ws-a", { field: "priority", direction: "desc" });
    store.toggle("my", "ws-a", "labels", "bug");
    store.clear("my", "ws-a");
    await flush();
    // "Clear filters" keeps the sort.
    expect(useIssueListFilterStore.getState().sorts["my:ws-a"]).toEqual({ field: "priority", direction: "desc" });

    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    await useIssueListFilterStore.getState().hydrate("my", "ws-b");
    expect(useIssueListFilterStore.getState().sorts["my:ws-a"]).toEqual({ field: "priority", direction: "desc" });
    expect(useIssueListFilterStore.getState().sorts["my:ws-b"]).toBeUndefined();

    // Back to Manual deletes the stored value.
    useIssueListFilterStore.getState().setSort("my", "ws-a", MANUAL_SORT);
    await flush();
    expect(storage.has(issueListSortStorageKey("my", "ws-a"))).toBe(false);
  });

  it("falls back to Manual for an unknown stored sort", async () => {
    storage.set(issueListSortStorageKey("my", "ws-a"), '{"field":"last_activity","direction":"desc"}');
    await useIssueListFilterStore.getState().hydrate("my", "ws-a");
    expect(useIssueListFilterStore.getState().sorts["my:ws-a"]).toBeUndefined();
  });
});

describe("issue list filter store logout race", () => {
  beforeEach(() => {
    storage.clear();
    useIssueListFilterStore.getState().reset();
  });

  it("drops a hydrate that finishes after reset", async () => {
    useIssueListFilterStore.getState().toggle("project", "ws-a", "labels", "bug");
    useIssueListFilterStore.getState().setSort("project", "ws-a", { field: "priority", direction: "asc" });
    await flush();
    expect(storage.has(issueListFilterStorageKey("project", "ws-a"))).toBe(true);
    expect(storage.has(issueListSortStorageKey("project", "ws-a"))).toBe(true);

    useIssueListFilterStore.setState({ filters: {}, sorts: {}, hydrated: {} });
    const pending = useIssueListFilterStore.getState().hydrate("project", "ws-a");
    useIssueListFilterStore.getState().reset();
    await pending;
    const state = useIssueListFilterStore.getState();
    expect(state.filters["project:ws-a"]).toBeUndefined();
    expect(state.sorts["project:ws-a"]).toBeUndefined();
    expect(state.hydrated["project:ws-a"]).toBeUndefined();
  });
});
