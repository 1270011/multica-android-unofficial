/**
 * Mobile-only zustand store for the My Issues tab
 * (`assigned, created, all`), remembered per workspace and
 * across restarts like the list filters (`issue-list-filter-store.ts`):
 * SecureStore entry `rb.my_issues_scope.<wsId>`, written through
 * `saveFilter` so logout forgets it.
 *
 * Migration: the former tab `agents` loads as `all` plus the filter
 * "My agents and squads" (`involvesMe`) of the `my` list.
 */
import { useEffect } from "react";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { saveFilter } from "@/lib/filter-storage";
import {
  isMyIssuesScope,
  type MyIssuesScope,
} from "@/data/queries/issue-keys";
import { useIssueListFilterStore } from "./issue-list-filter-store";

export const DEFAULT_MY_ISSUES_SCOPE: MyIssuesScope = "assigned";

export function myIssuesScopeStorageKey(wsId: string): string {
  // SecureStore keys allow only [A-Za-z0-9._-].
  return `rb.my_issues_scope.${wsId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export interface StoredMyIssuesScope {
  scope: MyIssuesScope;
  /** The stored value was the old `agents` tab. */
  migratedFromAgents: boolean;
}

/** Tolerant parse; unknown values fall back to the default tab. */
export function parseStoredMyIssuesScope(raw: string | null): StoredMyIssuesScope {
  if (raw === "agents") return { scope: "all", migratedFromAgents: true };
  return {
    scope: isMyIssuesScope(raw) ? raw : DEFAULT_MY_ISSUES_SCOPE,
    migratedFromAgents: false,
  };
}

interface MyIssuesViewState {
  scopes: Record<string, MyIssuesScope>;
  hydrated: Record<string, true>;
  /** Bumped by `reset`: a read still running from before is dropped. */
  generation: number;
  hydrate: (wsId: string) => Promise<void>;
  setScope: (wsId: string, scope: MyIssuesScope) => void;
  /** Forget everything in memory (logout); storage: clearAllFilterStorage. */
  reset: () => void;
}

export const useMyIssuesViewStore = create<MyIssuesViewState>()((set, get) => ({
  scopes: {},
  hydrated: {},
  generation: 0,
  reset: () => set((state) => ({ scopes: {}, hydrated: {}, generation: state.generation + 1 })),
  setScope: (wsId, scope) => {
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      scopes: { ...state.scopes, [wsId]: scope },
    }));
    void saveFilter(
      myIssuesScopeStorageKey(wsId),
      scope === DEFAULT_MY_ISSUES_SCOPE ? null : scope,
    );
  },
  hydrate: async (wsId) => {
    if (get().hydrated[wsId]) return;
    const generation = get().generation;
    let raw: string | null = null;
    try {
      raw = await SecureStore.getItemAsync(myIssuesScopeStorageKey(wsId));
    } catch {
      // Unreadable storage: start on the default tab.
    }
    // A tab chosen before the read finished wins over the stored one; a
    // logout (reset) in between drops the read.
    if (get().hydrated[wsId] || get().generation !== generation) return;
    const stored = parseStoredMyIssuesScope(raw);
    set((state) => ({
      hydrated: { ...state.hydrated, [wsId]: true },
      scopes: { ...state.scopes, [wsId]: stored.scope },
    }));
    if (stored.migratedFromAgents) {
      const filters = useIssueListFilterStore.getState();
      await filters.hydrate("my", wsId);
      // A logout during the filter read must not migrate into the next account.
      if (get().generation !== generation) return;
      filters.setInvolvesMe("my", wsId, true);
      void saveFilter(myIssuesScopeStorageKey(wsId), stored.scope);
    }
  },
}));

/** Tab of My Issues in one workspace; loads the stored value on first use. */
export function useMyIssuesScope(
  wsId: string | null,
): [MyIssuesScope, (scope: MyIssuesScope) => void] {
  useEffect(() => {
    if (wsId) void useMyIssuesViewStore.getState().hydrate(wsId);
  }, [wsId]);
  const scope =
    useMyIssuesViewStore((state) => (wsId ? state.scopes[wsId] : undefined)) ??
    DEFAULT_MY_ISSUES_SCOPE;
  const setScope = (next: MyIssuesScope) => {
    if (wsId) useMyIssuesViewStore.getState().setScope(wsId, next);
  };
  return [scope, setScope];
}
