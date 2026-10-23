/**
 * Issue-list filters per list and workspace: status, priority,
 * project, label, due date. Same build as the inbox filter
 * (inbox-filter-store.ts): remembered across restarts in SecureStore,
 * one entry per list and workspace (`rb.issue_filters.<list>.<wsId>`), and
 * a toggle before hydration finished wins over the stored value.
 *
 * Replaces the session-only status/priority fields of the old view stores;
 * the tabs of My Issues stay in `useMyIssuesViewStore`.
 * Because state is keyed by workspace, a workspace switch shows that
 * workspace's own filters instead of clearing them.
 */
import { useEffect } from "react";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { saveFilter } from "@/lib/filter-storage";
import {
  EMPTY_ISSUE_LIST_FILTERS,
  type ActorKey,
  type IssueListFilterDimension,
  type IssueListFilters,
  isEmptyIssueListFilters,
  parseStoredIssueListFilters,
  serializeIssueListFilters,
  setIncludeNoAssignee,
  setInvolvesMe,
  toggleAssignee,
  toggleAssigneeType,
  toggleCreator,
  toggleIssueListFilter,
} from "@/lib/issue-list-filters";
import {
  type ActorChipClear,
  clearActorChip,
  clearFilterSection,
  type FilterSection,
} from "@/lib/actor-filter-options";
import {
  type IssueListSort,
  MANUAL_SORT,
  parseStoredSort,
  serializeSort,
} from "@/lib/issue-list-sort";
import type { IssueAssigneeType } from "@multica/core/types";

/**
 * `my` = My Issues, `project` = project page. `all` was the workspace Issues
 * page, gone since 2.0; its stored filters move to `my` once
 * (`adoptLegacyAllFilters`).
 */
export type IssueFilterList = "all" | "my" | "project";

export function isIssueFilterList(value: unknown): value is IssueFilterList {
  return value === "all" || value === "my" || value === "project";
}

function entryKey(list: IssueFilterList, wsId: string): string {
  return `${list}:${wsId}`;
}

export function issueListFilterStorageKey(list: IssueFilterList, wsId: string): string {
  // SecureStore keys allow only [A-Za-z0-9._-].
  return `rb.issue_filters.${list}.${wsId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** Sort order per list and workspace, next to the filters. */
export function issueListSortStorageKey(list: IssueFilterList, wsId: string): string {
  return `rb.issue_sort.${list}.${wsId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

interface IssueListFilterState {
  filters: Record<string, IssueListFilters>;
  /**
   * Sort order. Kept apart from `filters`: it is no filter
   * (no count, no chip) and "Clear" in the sheet leaves it alone.
   */
  sorts: Record<string, IssueListSort>;
  hydrated: Record<string, true>;
  /** Bumped by `reset`: a read still running from before is dropped. */
  generation: number;
  hydrate: (list: IssueFilterList, wsId: string) => Promise<void>;
  toggle: (
    list: IssueFilterList,
    wsId: string,
    dimension: IssueListFilterDimension,
    value: string,
  ) => void;
  toggleNoProject: (list: IssueFilterList, wsId: string) => void;
  /** "My agents and squads", only meaningful for `my`. */
  setInvolvesMe: (list: IssueFilterList, wsId: string, value: boolean) => void;
  /** Assignee/creator filters, only meaningful for `my`. */
  setIncludeNoAssignee: (list: IssueFilterList, wsId: string, value: boolean) => void;
  toggleAssignee: (list: IssueFilterList, wsId: string, actor: ActorKey) => void;
  toggleAssigneeType: (list: IssueFilterList, wsId: string, type: IssueAssigneeType) => void;
  toggleCreator: (list: IssueFilterList, wsId: string, actor: ActorKey) => void;
  /** ✕ on an assignee/creator chip (D3b). */
  clearActorChip: (list: IssueFilterList, wsId: string, clear: ActorChipClear) => void;
  /** Reset one section after a 400 from the server (D3b). */
  clearSection: (list: IssueFilterList, wsId: string, section: FilterSection) => void;
  clear: (list: IssueFilterList, wsId: string) => void;
  /** Replace all filters at once (applying a saved view). */
  replace: (list: IssueFilterList, wsId: string, filters: IssueListFilters) => void;
  setSort: (list: IssueFilterList, wsId: string, sort: IssueListSort) => void;
  /** Forget everything in memory (logout); storage: clearAllFilterStorage. */
  reset: () => void;
}

/**
 * One-time migration of the old "All issues" filters: they replace the My Issues filters only when those are empty.
 */
export function adoptLegacyAllFilters(
  my: IssueListFilters,
  all: IssueListFilters,
): IssueListFilters {
  return isEmptyIssueListFilters(my) && !isEmptyIssueListFilters(all) ? all : my;
}

async function readStoredSort(list: IssueFilterList, wsId: string): Promise<IssueListSort> {
  try {
    return parseStoredSort(await SecureStore.getItemAsync(issueListSortStorageKey(list, wsId)));
  } catch {
    return MANUAL_SORT;
  }
}

async function readStored(list: IssueFilterList, wsId: string): Promise<IssueListFilters> {
  try {
    return parseStoredIssueListFilters(
      await SecureStore.getItemAsync(issueListFilterStorageKey(list, wsId)),
    );
  } catch {
    // Unreadable storage: start without filters.
    return EMPTY_ISSUE_LIST_FILTERS;
  }
}

function persist(list: IssueFilterList, wsId: string, filters: IssueListFilters) {
  const key = issueListFilterStorageKey(list, wsId);
  void saveFilter(key, isEmptyIssueListFilters(filters) ? null : serializeIssueListFilters(filters));
}

export const useIssueListFilterStore = create<IssueListFilterState>()((set, get) => {
  const update = (
    list: IssueFilterList,
    wsId: string,
    next: (current: IssueListFilters) => IssueListFilters,
  ) => {
    const key = entryKey(list, wsId);
    const value = next(get().filters[key] ?? EMPTY_ISSUE_LIST_FILTERS);
    set((state) => ({
      hydrated: { ...state.hydrated, [key]: true },
      filters: { ...state.filters, [key]: value },
    }));
    persist(list, wsId, value);
  };

  return {
    filters: {},
    sorts: {},
    hydrated: {},
    generation: 0,
    reset: () =>
      set((state) => ({ filters: {}, sorts: {}, hydrated: {}, generation: state.generation + 1 })),
    hydrate: async (list, wsId) => {
      const key = entryKey(list, wsId);
      if (get().hydrated[key]) return;
      const generation = get().generation;
      let stored = await readStored(list, wsId);
      const storedSort = await readStoredSort(list, wsId);
      let adopted = false;
      if (list === "my") {
        const legacy = await readStored("all", wsId);
        if (!isEmptyIssueListFilters(legacy) && get().generation === generation) {
          const next = adoptLegacyAllFilters(stored, legacy);
          adopted = next !== stored;
          stored = next;
          void saveFilter(issueListFilterStorageKey("all", wsId), null);
        }
      }
      let applied = false;
      set((state) => {
        // A change before the read finished wins; a logout (reset) in
        // between drops the read.
        if (state.hydrated[key] || state.generation !== generation) return state;
        applied = true;
        const hydrated = { ...state.hydrated, [key]: true as const };
        const sorts =
          storedSort === MANUAL_SORT ? state.sorts : { ...state.sorts, [key]: storedSort };
        if (isEmptyIssueListFilters(stored)) return { hydrated, sorts };
        return { hydrated, sorts, filters: { ...state.filters, [key]: stored } };
      });
      if (applied && adopted) persist(list, wsId, stored);
    },
    toggle: (list, wsId, dimension, value) =>
      update(list, wsId, (current) => toggleIssueListFilter(current, dimension, value)),
    toggleNoProject: (list, wsId) =>
      update(list, wsId, (current) => ({
        ...current,
        includeNoProject: !current.includeNoProject,
      })),
    setInvolvesMe: (list, wsId, value) =>
      update(list, wsId, (current) => setInvolvesMe(current, value)),
    setIncludeNoAssignee: (list, wsId, value) =>
      update(list, wsId, (current) => setIncludeNoAssignee(current, value)),
    toggleAssignee: (list, wsId, actor) =>
      update(list, wsId, (current) => toggleAssignee(current, actor)),
    toggleAssigneeType: (list, wsId, type) =>
      update(list, wsId, (current) => toggleAssigneeType(current, type)),
    toggleCreator: (list, wsId, actor) =>
      update(list, wsId, (current) => toggleCreator(current, actor)),
    clearActorChip: (list, wsId, clear) =>
      update(list, wsId, (current) => clearActorChip(current, clear)),
    clearSection: (list, wsId, section) =>
      update(list, wsId, (current) => clearFilterSection(current, section)),
    clear: (list, wsId) => update(list, wsId, () => EMPTY_ISSUE_LIST_FILTERS),
    replace: (list, wsId, filters) =>
      update(list, wsId, () =>
        isEmptyIssueListFilters(filters) ? EMPTY_ISSUE_LIST_FILTERS : filters,
      ),
    setSort: (list, wsId, sort) => {
      const key = entryKey(list, wsId);
      set((state) => ({
        hydrated: { ...state.hydrated, [key]: true },
        sorts: { ...state.sorts, [key]: sort },
      }));
      void saveFilter(issueListSortStorageKey(list, wsId), serializeSort(sort));
    },
  };
});

/**
 * Filters of one list in one workspace, with a stable empty fallback.
 * Loads the stored value on first use.
 */
export function useIssueListFilters(
  list: IssueFilterList,
  wsId: string | null,
): IssueListFilters {
  useEffect(() => {
    if (wsId) void useIssueListFilterStore.getState().hydrate(list, wsId);
  }, [list, wsId]);
  return (
    useIssueListFilterStore((state) =>
      wsId ? state.filters[entryKey(list, wsId)] : undefined,
    ) ?? EMPTY_ISSUE_LIST_FILTERS
  );
}

/** Sort order of one list in one workspace; "Manual" until set. */
export function useIssueListSort(
  list: IssueFilterList,
  wsId: string | null,
): IssueListSort {
  useEffect(() => {
    if (wsId) void useIssueListFilterStore.getState().hydrate(list, wsId);
  }, [list, wsId]);
  return (
    useIssueListFilterStore((state) =>
      wsId ? state.sorts[entryKey(list, wsId)] : undefined,
    ) ?? MANUAL_SORT
  );
}
