/**
 * Binds the W4 picker helpers (lib/visible-actors.ts) to the workspace's
 * hidden people/agents from Settings › View. Loads the stored list on first
 * use; local only, no network request.
 */
import { useMemo } from "react";
import {
  useHiddenActors,
  useViewPrefsHydration,
} from "@/data/stores/view-prefs-store";
import type { HiddenActors } from "./view-prefs";
import {
  isPickerActorHidden,
  type PickerActorRef,
  type SplitActorsOptions,
  splitVisibleActors,
  type VisibleActorSplit,
  visibleActors,
} from "./visible-actors";

export interface VisibleActorsFilter {
  hidden: HiddenActors;
  isHidden: (ref: PickerActorRef) => boolean;
  split: <T>(
    items: readonly T[],
    refOf: (item: T) => PickerActorRef | null,
    opts?: SplitActorsOptions,
  ) => VisibleActorSplit<T>;
  visible: <T>(
    items: readonly T[],
    refOf: (item: T) => PickerActorRef | null,
    selected?: readonly PickerActorRef[],
  ) => T[];
}

export function useVisibleActors(wsId: string | null): VisibleActorsFilter {
  useViewPrefsHydration(wsId);
  const hidden = useHiddenActors(wsId);
  return useMemo(
    () => ({
      hidden,
      isHidden: (ref) => isPickerActorHidden(hidden, ref),
      split: (items, refOf, opts) => splitVisibleActors(items, refOf, hidden, opts),
      visible: (items, refOf, selected) => visibleActors(items, refOf, hidden, selected),
    }),
    [hidden],
  );
}
