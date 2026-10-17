/**
 * List or board per issue list:
 * All issues, My issues and the project issues each remember their own
 * choice on the device. Persisted in expo-secure-store like the theme
 * preference; until the read finishes every list shows the list view.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

export type IssueViewMode = "list" | "board";
export type IssueViewKey = "all" | "my" | "project";

const STORAGE_KEY = "issue-view-modes";
const KEYS: IssueViewKey[] = ["all", "my", "project"];

/** Tolerant parse: unknown keys and values are dropped. */
export function parseViewModes(raw: string | null | undefined): Partial<Record<IssueViewKey, IssueViewMode>> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<IssueViewKey, IssueViewMode>> = {};
    for (const key of KEYS) {
      const v = data?.[key];
      if (v === "list" || v === "board") out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

interface State {
  modes: Partial<Record<IssueViewKey, IssueViewMode>>;
  setMode: (key: IssueViewKey, mode: IssueViewMode) => void;
}

export const useIssueViewModeStore = create<State>((set, get) => ({
  modes: {},
  setMode: (key, mode) => {
    set({ modes: { ...get().modes, [key]: mode } });
    void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(get().modes)).catch(() => {});
  },
}));

void SecureStore.getItemAsync(STORAGE_KEY)
  .then((raw) => {
    // A choice made before the read finished wins over the stored one.
    useIssueViewModeStore.setState((s) => ({ modes: { ...parseViewModes(raw), ...s.modes } }));
  })
  .catch(() => {});

export function useIssueViewMode(key: IssueViewKey): [IssueViewMode, (mode: IssueViewMode) => void] {
  const mode = useIssueViewModeStore((s) => s.modes[key] ?? "list");
  const setMode = useIssueViewModeStore((s) => s.setMode);
  return [mode, (m) => setMode(key, m)];
}
