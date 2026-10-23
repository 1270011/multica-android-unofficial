/**
 * Multi-select in the issue list. Held in memory only: a selection never survives a restart.
 *
 * The screen owns the lifecycle: it starts the mode on long press (or the
 * TalkBack action "Select") or empty from the header menu ⋮ → "Select"
 * (D5b, the only way in on the board), ends it on back, tab change or blur, and calls
 * `prune` with the visible issue ids whenever the filter or the list
 * changes, so the selection only ever holds issues the user can see. The
 * batch actions (D6/D7) read `ids` from here.
 *
 * A batch picker (D6) is a sheet route on top of the list, so the list
 * loses focus while it is open. `pickerOpen` tells the screen to keep the
 * selection over that blur; the picker clears it when it closes.
 */
import { create } from "zustand";

interface State {
  /** Selection mode on: taps toggle rows instead of opening issues. */
  active: boolean;
  /** Selected issue ids, in selection order. */
  ids: string[];
  /** Start the mode with this issue selected. */
  start: (id: string) => void;
  /** Start the mode with nothing selected (header menu ⋮ → "Select"). */
  begin: () => void;
  toggle: (id: string) => void;
  /** "All (n)": select every visible issue, or none when all are selected. */
  toggleAll: (visibleIds: readonly string[]) => void;
  /** Keep only ids that are still visible (filter or list changed). */
  prune: (visibleIds: readonly string[]) => void;
  /** A batch picker sheet is open on top of the list (keep on blur). */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** End the mode and drop the selection. */
  reset: () => void;
}

/** True when every visible issue is selected (and there is at least one). */
export function allSelected(
  ids: readonly string[],
  visibleIds: readonly string[],
): boolean {
  if (visibleIds.length === 0) return false;
  const selected = new Set(ids);
  return visibleIds.every((id) => selected.has(id));
}

export const useIssueSelectionStore = create<State>((set, get) => ({
  active: false,
  ids: [],
  pickerOpen: false,
  start: (id) => set({ active: true, ids: [id] }),
  begin: () => set({ active: true, ids: [] }),
  toggle: (id) => {
    const { ids } = get();
    set({
      ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  },
  toggleAll: (visibleIds) => {
    const { ids } = get();
    set({ ids: allSelected(ids, visibleIds) ? [] : [...visibleIds] });
  },
  prune: (visibleIds) => {
    const { ids } = get();
    const visible = new Set(visibleIds);
    const kept = ids.filter((id) => visible.has(id));
    // Same content keeps the same array, so subscribers don't re-render.
    if (kept.length !== ids.length) set({ ids: kept });
  },
  setPickerOpen: (open) => {
    if (get().pickerOpen !== open) set({ pickerOpen: open });
  },
  reset: () => {
    const { active, ids, pickerOpen } = get();
    if (active || ids.length > 0 || pickerOpen) {
      set({ active: false, ids: [], pickerOpen: false });
    }
  },
}));
