/**
 * The saved view applied in My Issues, per workspace. Remembered across an Activity
 * recreation (font size, dark mode) and a restart like the filters, sort
 * and tab: SecureStore entry `rb.active_issue_view.<wsId>`,
 * written through `saveFilter` so logout forgets it. A change before the
 * stored entry was read wins over it.
 *
 * Applying a view overwrites the list's own filters, sort, tab and mode, so
 * the first apply remembers them (`previous`); "Standard" and a deleted view
 * (404) bring them back. Switching between views keeps the first snapshot.
 *
 * D8c keeps the view itself (owner, visibility, revision, unknown keys) and
 * the state it put on screen (`applied`): the bar compares that with the
 * current filters ("· geändert"), "Verwerfen" puts it back, and "Speichern"
 * patches the view with its `revision`.
 */
import { useEffect } from "react";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { IssueView } from "@multica/core/api/schemas";
import { isMyIssuesScope } from "@/data/queries/issue-keys";
import { saveFilter } from "@/lib/filter-storage";
import {
  parseStoredIssueListFilters,
  serializeIssueListFilters,
} from "@/lib/issue-list-filters";
import { parseStoredSort } from "@/lib/issue-list-sort";
import {
  type AppliedView,
  type AppViewState,
  appStateFromView,
} from "@/lib/issue-view-mapping";

export interface ActiveIssueView {
  readonly id: string;
  readonly name: string;
  readonly hiddenFilters: boolean;
  readonly view: IssueView;
  readonly applied: AppViewState;
}

export function activeIssueViewStorageKey(wsId: string): string {
  // SecureStore keys allow only [A-Za-z0-9._-].
  return `rb.active_issue_view.${wsId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export interface StoredActiveIssueView {
  active: ActiveIssueView;
  previous: AppViewState | null;
}

function serializeState(s: AppViewState) {
  return {
    tab: s.tab,
    filters: JSON.parse(serializeIssueListFilters(s.filters)) as unknown,
    sort: s.sort,
    viewMode: s.viewMode,
  };
}

export function serializeActiveIssueView(
  active: ActiveIssueView,
  previous: AppViewState | null,
): string {
  return JSON.stringify({
    active: { ...active, applied: serializeState(active.applied) },
    previous: previous ? serializeState(previous) : null,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseState(value: unknown): AppViewState | null {
  const s = record(value);
  if (!s || !isMyIssuesScope(s.tab)) return null;
  return {
    tab: s.tab,
    filters: parseStoredIssueListFilters(JSON.stringify(s.filters ?? null)),
    sort: parseStoredSort(s.sort ? JSON.stringify(s.sort) : null),
    viewMode: s.viewMode === "board" ? "board" : "list",
  };
}

/** Tolerant parse; anything unreadable means "no view" (Standard). */
export function parseStoredActiveIssueView(raw: string | null): StoredActiveIssueView | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const active = record(record(value)?.active);
  const view = record(active?.view);
  const applied = parseState(active?.applied);
  if (
    !active ||
    !view ||
    !applied ||
    typeof active.id !== "string" ||
    typeof active.name !== "string" ||
    view.id !== active.id
  ) {
    return null;
  }
  return {
    active: {
      id: active.id,
      name: active.name,
      hiddenFilters: active.hiddenFilters === true,
      view: view as unknown as IssueView,
      applied,
    },
    previous: parseState(record(value)?.previous),
  };
}

function persist(wsId: string, state: Pick<ActiveIssueViewState, "active" | "previous">) {
  const active = state.active[wsId];
  void saveFilter(
    activeIssueViewStorageKey(wsId),
    active ? serializeActiveIssueView(active, state.previous[wsId] ?? null) : null,
  );
}

interface ActiveIssueViewState {
  active: Record<string, ActiveIssueView>;
  previous: Record<string, AppViewState>;
  hydrated: Record<string, true>;
  /** Bumped by `reset`: a read still running from before is dropped. */
  generation: number;
  /** Load the stored view of `wsId` once (no-op after a change). */
  hydrate: (wsId: string) => Promise<void>;
  /** Mark `view` as applied; returns the state to put on screen. */
  apply: (wsId: string, view: IssueView, current: AppViewState) => AppliedView;
  /**
   * The applied view was saved or edited: keep it active with the server's
   * answer; `applied` (default: unchanged) is what is on screen now.
   */
  update: (wsId: string, view: IssueView, applied?: AppViewState) => void;
  /** Back to "Standard": returns the snapshot to restore (null = none). */
  exit: (wsId: string) => AppViewState | null;
  /** Drop the view but keep the filters on screen (manual tab change). */
  forget: (wsId: string) => void;
  /** Forget everything in memory (logout); storage: clearAllFilterStorage. */
  reset: () => void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function stateOf(s: AppViewState): AppViewState {
  return { tab: s.tab, filters: s.filters, sort: s.sort, viewMode: s.viewMode };
}

export const useActiveIssueViewStore = create<ActiveIssueViewState>()((set, get) => ({
  active: {},
  previous: {},
  hydrated: {},
  generation: 0,
  hydrate: async (wsId) => {
    if (get().hydrated[wsId]) return;
    const generation = get().generation;
    let raw: string | null = null;
    try {
      raw = await SecureStore.getItemAsync(activeIssueViewStorageKey(wsId));
    } catch {
      // Unreadable storage: start on "Standard".
    }
    const stored = parseStoredActiveIssueView(raw);
    set((state) => {
      // A view applied or left before the read finished wins; after a
      // logout (reset) the old account's view must not come back.
      if (state.hydrated[wsId] || state.generation !== generation) return state;
      const hydrated = { ...state.hydrated, [wsId]: true as const };
      if (!stored) return { hydrated };
      return {
        hydrated,
        active: { ...state.active, [wsId]: stored.active },
        previous: stored.previous
          ? { ...state.previous, [wsId]: stored.previous }
          : state.previous,
      };
    });
  },
  apply: (wsId, view, current) => {
    const applied = appStateFromView(view);
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      active: {
        ...state.active,
        [wsId]: {
          id: view.id,
          name: view.name,
          hiddenFilters: applied.hiddenFilters,
          view,
          applied: stateOf(applied),
        },
      },
      previous: state.previous[wsId]
        ? state.previous
        : { ...state.previous, [wsId]: current },
    }));
    persist(wsId, get());
    return applied;
  },
  update: (wsId, view, applied) => {
    set((state) => {
      const current = state.active[wsId];
      if (!current || current.id !== view.id) return state;
      return {
        active: {
          ...state.active,
          [wsId]: {
            ...current,
            name: view.name,
            view,
            applied: applied ? stateOf(applied) : current.applied,
          },
        },
      };
    });
    persist(wsId, get());
  },
  exit: (wsId) => {
    const previous = get().previous[wsId] ?? null;
    get().forget(wsId);
    return previous;
  },
  forget: (wsId) => {
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      active: without(state.active, wsId),
      previous: without(state.previous, wsId),
    }));
    persist(wsId, get());
  },
  reset: () =>
    set((state) => ({ active: {}, previous: {}, hydrated: {}, generation: state.generation + 1 })),
}));

/** Applied view of one workspace; loads the stored one on first use. */
export function useActiveIssueView(wsId: string | null): ActiveIssueView | null {
  useEffect(() => {
    if (wsId) void useActiveIssueViewStore.getState().hydrate(wsId);
  }, [wsId]);
  return useActiveIssueViewStore((s) => (wsId ? (s.active[wsId] ?? null) : null));
}
