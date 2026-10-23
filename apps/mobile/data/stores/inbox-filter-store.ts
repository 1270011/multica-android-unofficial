/**
 * Inbox filter state per workspace, web parity with
 * packages/core/inbox/filter-store.ts (`filtersByWorkspace`).
 *
 * Unlike the session-scoped issue-list stores, the inbox filter is
 * remembered per workspace across restarts: one small SecureStore entry per
 * workspace (`rb.inbox_filters.<wsId>`), like the other small device prefs
 * (lib/clipboard-clear-pref.ts). `hydrate` loads a workspace once; a toggle
 * before hydration finished wins over the stored value.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { saveFilter } from "@/lib/filter-storage";
import {
  EMPTY_INBOX_FILTERS,
  type InboxFilterDimension,
  type InboxFilters,
  isEmptyInboxFilters,
  parseStoredInboxFilters,
  serializeInboxFilters,
  toggleInboxFilter,
} from "@/lib/inbox-filters";

export function inboxFilterStorageKey(wsId: string): string {
  // SecureStore keys allow only [A-Za-z0-9._-].
  return `rb.inbox_filters.${wsId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

interface InboxFilterState {
  filtersByWorkspace: Record<string, InboxFilters>;
  /** Workspaces whose stored value was loaded (or deliberately skipped). */
  hydrated: Record<string, true>;
  /** Bumped by `reset`: a read still running from before is dropped. */
  generation: number;
  hydrate: (wsId: string) => Promise<void>;
  toggle: (wsId: string, dimension: InboxFilterDimension, value: string) => void;
  clear: (wsId: string) => void;
  /** Forget everything in memory (logout); storage: clearAllFilterStorage. */
  reset: () => void;
}

function persist(wsId: string, filters: InboxFilters) {
  const key = inboxFilterStorageKey(wsId);
  void saveFilter(key, isEmptyInboxFilters(filters) ? null : serializeInboxFilters(filters));
}

export const useInboxFilterStore = create<InboxFilterState>()((set, get) => ({
  filtersByWorkspace: {},
  hydrated: {},
  generation: 0,
  reset: () =>
    set((state) => ({ filtersByWorkspace: {}, hydrated: {}, generation: state.generation + 1 })),
  hydrate: async (wsId) => {
    if (get().hydrated[wsId]) return;
    const generation = get().generation;
    let stored = EMPTY_INBOX_FILTERS;
    try {
      stored = parseStoredInboxFilters(
        await SecureStore.getItemAsync(inboxFilterStorageKey(wsId)),
      );
    } catch {
      // Unreadable storage: start without filters.
    }
    set((state) => {
      // A toggle before the read finished wins; a logout (reset) in between
      // drops the read.
      if (state.hydrated[wsId] || state.generation !== generation) return state;
      const hydrated = { ...state.hydrated, [wsId]: true as const };
      if (isEmptyInboxFilters(stored)) return { hydrated };
      return {
        hydrated,
        filtersByWorkspace: { ...state.filtersByWorkspace, [wsId]: stored },
      };
    });
  },
  toggle: (wsId, dimension, value) => {
    const current = get().filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
    const next = toggleInboxFilter(current, dimension, value);
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      filtersByWorkspace: { ...state.filtersByWorkspace, [wsId]: next },
    }));
    persist(wsId, next);
  },
  clear: (wsId) => {
    set((state) => {
      const { [wsId]: _removed, ...filtersByWorkspace } =
        state.filtersByWorkspace;
      return {
        hydrated: { ...state.hydrated, [wsId]: true },
        filtersByWorkspace,
      };
    });
    persist(wsId, EMPTY_INBOX_FILTERS);
  },
}));

/** Workspace-isolated filters with a stable empty fallback. */
export function useInboxFilters(wsId: string | null): InboxFilters {
  return (
    useInboxFilterStore((state) =>
      wsId ? state.filtersByWorkspace[wsId] : undefined,
    ) ?? EMPTY_INBOX_FILTERS
  );
}
