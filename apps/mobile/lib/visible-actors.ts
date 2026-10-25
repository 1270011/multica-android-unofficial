/**
 * People and agents hidden in Settings › View in the pickers:
 * @-sheet, @-suggestion bar, assignee, project lead and chat agent picker
 * (package P5, A4.1–A4.3).
 *
 * - Hidden actors drop out of the list.
 * - A picked value always stays (A4.2: a hidden assignee is listed as
 *   picked and can be unticked).
 * - While searching, hidden matches come back in their own dimmed
 *   "Hidden" section and stay pickable (A4.3), like the filter sub-screen
 *   of #180 (`hiddenActorOptions`).
 * - Squads are never hidden (decision 1).
 *
 * Pure functions only; `useVisibleActors` (lib/use-visible-actors.ts)
 * binds them to the workspace's stored list. Name matching stays with the
 * caller, which already filters by its own rules.
 */
import { type HiddenActors, isActorHidden } from "./view-prefs";

export type PickerActorType = "member" | "agent" | "squad";

export interface PickerActorRef {
  type: PickerActorType;
  id: string;
}

export interface VisibleActorSplit<T> {
  /** Not hidden, or picked; caller order kept. */
  visible: T[];
  /** Hidden and not picked; empty unless searching. */
  hidden: T[];
}

export interface SplitActorsOptions {
  /** Picked actors, kept in `visible` even when hidden. */
  selected?: readonly PickerActorRef[];
  /** Search text; hidden matches only come back while it is non-empty. */
  query?: string;
}

/** Whether W4 hides the actor; squads cannot be hidden. */
export function isPickerActorHidden(
  hidden: HiddenActors,
  ref: PickerActorRef,
): boolean {
  if (ref.type === "squad") return false;
  return isActorHidden(hidden, ref.type === "member" ? "members" : "agents", ref.id);
}

/**
 * Splits `items` into the regular list and the dimmed "Hidden" section.
 * `refOf` returns null for rows that are no actor (e.g. `@all`); those
 * always stay visible.
 */
export function splitVisibleActors<T>(
  items: readonly T[],
  refOf: (item: T) => PickerActorRef | null,
  hidden: HiddenActors,
  opts: SplitActorsOptions = {},
): VisibleActorSplit<T> {
  const searching = (opts.query ?? "").trim() !== "";
  const picked = new Set((opts.selected ?? []).map(refKey));
  const visible: T[] = [];
  const dimmed: T[] = [];
  for (const item of items) {
    const ref = refOf(item);
    if (!ref || !isPickerActorHidden(hidden, ref) || picked.has(refKey(ref))) {
      visible.push(item);
    } else if (searching) {
      dimmed.push(item);
    }
  }
  return { visible, hidden: dimmed };
}

/** Only the visible part, for pickers without a search (chat agent picker). */
export function visibleActors<T>(
  items: readonly T[],
  refOf: (item: T) => PickerActorRef | null,
  hidden: HiddenActors,
  selected?: readonly PickerActorRef[],
): T[] {
  return splitVisibleActors(items, refOf, hidden, { selected }).visible;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Row tag of a dimmed row: "Agent" → "Agent · hidden" (W4: not by colour alone). */
export function withHiddenNote(label: string, hidden: boolean, t: Translate): string {
  return hidden ? `${label} · ${t("picker.hidden_note")}` : label;
}

function refKey(ref: PickerActorRef): string {
  return `${ref.type}:${ref.id}`;
}
