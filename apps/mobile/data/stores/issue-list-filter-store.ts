/**
 * Issue-list filters per list and workspace: status, priority,
 * project, label, due date. Same build as the inbox filter
 * (inbox-filter-store.ts, F1): remembered across restarts in SecureStore,
 * one entry per list and workspace (`rb.issue_filters.<list>.<wsId>`), and
 * a toggle before hydration finished wins over the stored value.
 *
 * Replaces the session-only status/priority fields of the old view stores;
 * the scope tabs stay in `useIssuesViewStore` / `useMyIssuesViewStore`.
 * Because state is keyed by workspace, a workspace switch shows that
 * workspace's own filters instead of clearing them.
 */
import { useEffect } from "react";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { saveFilter } from "@/lib/filter-storage";
import {
  EMPTY_ISSUE_LIST_FILTERS,
  type IssueListFilterDimension,
  type IssueListFilters,
  isEmptyIssueListFilters,
  parseStoredIssueListFilters,
  serializeIssueListFilters,
  toggleIssueListFilter,
} from "@/lib/issue-list-filters";

/** `all` = workspace Issues page, `my` = My Issues, `project` = project page. */
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

interface IssueListFilterState {
  filters: Record<string, IssueListFilters>;
  hydrated: Record<string, true>;
  hydrate: (list: IssueFilterList, wsId: string) => Promise<void>;
  toggle: (
    list: IssueFilterList,
    wsId: string,
    dimension: IssueListFilterDimension,
    value: string,
  ) => void;
  toggleNoProject: (list: IssueFilterList, wsId: string) => void;
  clear: (list: IssueFilterList, wsId: string) => void;
  /** Forget everything in memory (logout); storage: clearAllFilterStorage. */
  reset: () => void;
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
    hydrated: {},
    reset: () => set({ filters: {}, hydrated: {} }),
    hydrate: async (list, wsId) => {
      const key = entryKey(list, wsId);
      if (get().hydrated[key]) return;
      let stored = EMPTY_ISSUE_LIST_FILTERS;
      try {
        stored = parseStoredIssueListFilters(
          await SecureStore.getItemAsync(issueListFilterStorageKey(list, wsId)),
        );
      } catch {
        // Unreadable storage: start without filters.
      }
      set((state) => {
        if (state.hydrated[key]) return state;
        const hydrated = { ...state.hydrated, [key]: true as const };
        if (isEmptyIssueListFilters(stored)) return { hydrated };
        return { hydrated, filters: { ...state.filters, [key]: stored } };
      });
    },
    toggle: (list, wsId, dimension, value) =>
      update(list, wsId, (current) => toggleIssueListFilter(current, dimension, value)),
    toggleNoProject: (list, wsId) =>
      update(list, wsId, (current) => ({
        ...current,
        includeNoProject: !current.includeNoProject,
      })),
    clear: (list, wsId) => update(list, wsId, () => EMPTY_ISSUE_LIST_FILTERS),
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
