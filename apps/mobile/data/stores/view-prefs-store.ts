/**
 * Settings › View state (W4–W6).
 *
 * Per workspace, remembered across restarts and forgotten on logout:
 *   - hidden people/agents   `rb.hidden_actors.<wsId>`
 *   - issue title filter     `rb.issue_title_filter.<wsId>`
 * Both are written through lib/filter-storage.ts, so its index makes the
 * logout clear (clearAllFilterStorage) reach every workspace, also ones
 * not loaded in this session.
 *
 * Per device, kept on logout (a preference like the language):
 *   - @-suggestion sort mode `rb.view.mention_sort`
 *
 * Same hydration rules as inbox-filter-store: `hydrate` loads a workspace
 * once; a change before the read finished wins; a logout (`reset`) in
 * between drops the read. A change replaces the whole stored value, so
 * editing screens wait for `useViewPrefsHydrated` before they allow input.
 * Consumers (P4–P10) use the hooks at the bottom.
 */
import { useEffect } from "react";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { saveFilter } from "@/lib/filter-storage";
import {
  DEFAULT_MENTION_SORT,
  DEFAULT_TITLE_FILTER,
  EMPTY_HIDDEN_ACTORS,
  type HiddenActorKind,
  type HiddenActors,
  hiddenActorsStorageKey,
  isDefaultTitleFilter,
  isEmptyHiddenActors,
  MENTION_SORT_STORAGE_KEY,
  type MentionSortMode,
  parseMentionSort,
  parseStoredHiddenActors,
  parseStoredTitleFilter,
  serializeHiddenActors,
  serializeTitleFilter,
  setActorHidden,
  type TitleFilterSettings,
  titleFilterStorageKey,
} from "@/lib/view-prefs";

interface ViewPrefsState {
  hiddenByWorkspace: Record<string, HiddenActors>;
  titleFilterByWorkspace: Record<string, TitleFilterSettings>;
  /** Workspaces whose stored values were loaded (or overwritten first). */
  hydrated: Record<string, true>;
  /** Bumped by `reset`: a read still running from before is dropped. */
  generation: number;
  mentionSort: MentionSortMode;
  mentionSortHydrated: boolean;

  hydrate: (wsId: string) => Promise<void>;
  hydrateDevice: () => Promise<void>;
  setActorHidden: (wsId: string, kind: HiddenActorKind, id: string, hidden: boolean) => void;
  /** Replace the whole list, e.g. after pruning deleted actors. */
  setHiddenActors: (wsId: string, hidden: HiddenActors) => void;
  showAllActors: (wsId: string) => void;
  setTitleFilter: (wsId: string, patch: Partial<TitleFilterSettings>) => void;
  setMentionSort: (mode: MentionSortMode) => void;
  /** Forget workspace data in memory (logout); storage: clearAllFilterStorage.
   *  The device sort mode stays. */
  reset: () => void;
}

function persistHidden(wsId: string, hidden: HiddenActors) {
  void saveFilter(
    hiddenActorsStorageKey(wsId),
    isEmptyHiddenActors(hidden) ? null : serializeHiddenActors(hidden),
  );
}

function persistTitleFilter(wsId: string, settings: TitleFilterSettings) {
  void saveFilter(
    titleFilterStorageKey(wsId),
    isDefaultTitleFilter(settings) ? null : serializeTitleFilter(settings),
  );
}

async function readOrNull(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null; // Unreadable storage: start with the defaults.
  }
}

export const useViewPrefsStore = create<ViewPrefsState>()((set, get) => {
  const writeHidden = (wsId: string, next: HiddenActors) => {
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      hiddenByWorkspace: { ...state.hiddenByWorkspace, [wsId]: next },
    }));
    persistHidden(wsId, next);
  };

  return {
    hiddenByWorkspace: {},
    titleFilterByWorkspace: {},
    hydrated: {},
    generation: 0,
    mentionSort: DEFAULT_MENTION_SORT,
    mentionSortHydrated: false,

    reset: () =>
      set((state) => ({
        hiddenByWorkspace: {},
        titleFilterByWorkspace: {},
        hydrated: {},
        generation: state.generation + 1,
      })),

    hydrate: async (wsId) => {
      if (get().hydrated[wsId]) return;
      const generation = get().generation;
      const [hiddenRaw, titleRaw] = await Promise.all([
        readOrNull(hiddenActorsStorageKey(wsId)),
        readOrNull(titleFilterStorageKey(wsId)),
      ]);
      const hidden = parseStoredHiddenActors(hiddenRaw);
      const titleFilter = parseStoredTitleFilter(titleRaw);
      set((state) => {
        if (state.hydrated[wsId] || state.generation !== generation) return state;
        return {
          hydrated: { ...state.hydrated, [wsId]: true },
          hiddenByWorkspace: { ...state.hiddenByWorkspace, [wsId]: hidden },
          titleFilterByWorkspace: { ...state.titleFilterByWorkspace, [wsId]: titleFilter },
        };
      });
    },

    hydrateDevice: async () => {
      if (get().mentionSortHydrated) return;
      const mode = parseMentionSort(await readOrNull(MENTION_SORT_STORAGE_KEY));
      set((state) =>
        state.mentionSortHydrated ? state : { mentionSort: mode, mentionSortHydrated: true },
      );
    },

    setActorHidden: (wsId, kind, id, hidden) => {
      const current = get().hiddenByWorkspace[wsId] ?? EMPTY_HIDDEN_ACTORS;
      const next = setActorHidden(current, kind, id, hidden);
      if (next === current) return;
      writeHidden(wsId, next);
    },

    setHiddenActors: (wsId, hidden) => writeHidden(wsId, hidden),

    showAllActors: (wsId) => writeHidden(wsId, EMPTY_HIDDEN_ACTORS),

    setTitleFilter: (wsId, patch) => {
      const current = get().titleFilterByWorkspace[wsId] ?? DEFAULT_TITLE_FILTER;
      const next = { ...current, ...patch };
      set((state) => ({
        hydrated: { ...state.hydrated, [wsId]: true },
        titleFilterByWorkspace: { ...state.titleFilterByWorkspace, [wsId]: next },
      }));
      persistTitleFilter(wsId, next);
    },

    setMentionSort: (mode) => {
      set({ mentionSort: mode, mentionSortHydrated: true });
      void SecureStore.setItemAsync(MENTION_SORT_STORAGE_KEY, mode).catch(() => {
        // Best effort; the in-memory value still applies.
      });
    },
  };
});

/** Loads the workspace's stored values (once) and the device sort mode. */
export function useViewPrefsHydration(wsId: string | null): void {
  useEffect(() => {
    const store = useViewPrefsStore.getState();
    void store.hydrateDevice();
    if (wsId) void store.hydrate(wsId);
  }, [wsId]);
}

/** Hidden people/agents of the workspace; stable empty fallback. */
export function useHiddenActors(wsId: string | null): HiddenActors {
  return (
    useViewPrefsStore((state) => (wsId ? state.hiddenByWorkspace[wsId] : undefined)) ??
    EMPTY_HIDDEN_ACTORS
  );
}

/** Title filter settings of the workspace; defaults until hydrated. */
export function useTitleFilterSettings(wsId: string | null): TitleFilterSettings {
  return (
    useViewPrefsStore((state) => (wsId ? state.titleFilterByWorkspace[wsId] : undefined)) ??
    DEFAULT_TITLE_FILTER
  );
}

export function useMentionSortMode(): MentionSortMode {
  return useViewPrefsStore((state) => state.mentionSort);
}

/** True once the workspace's stored values are loaded (avoids a flash of
 *  hidden actors or filtered issues during the first read). */
export function useViewPrefsHydrated(wsId: string | null): boolean {
  return useViewPrefsStore((state) => (wsId ? state.hydrated[wsId] === true : false));
}
